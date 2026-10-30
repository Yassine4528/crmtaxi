import {
  addDays,
  clientLabel,
  formatTime,
  fromIso,
  longDate,
  monday,
  normalize,
  shortDate,
  toIso,
  WEEKDAYS,
  type AgendaEvent,
  type Client,
} from '@taxi-crm/domain';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { api } from '../api/client.ts';
import { useCircuitIndex, useClients, useDrivers, useEvents, useSettings } from '../api/hooks.ts';
import { BillingDialog } from '../billing/BillingDialog.tsx';
import { CircuitsDialog } from '../circuits/CircuitsDialog.tsx';
import { ClientsDialog } from '../clients/ClientsDialog.tsx';
import { useDialogs } from '../components/Dialogs.tsx';
import { buildAgendaSheet, PrintDialog } from '../print/PrintDialog.tsx';
import { usePrint } from '../print/PrintProvider.tsx';
import { useSession } from '../session.tsx';
import { groupTours, isGroup, type GridItem } from './display.ts';
import { EventDialog, EVENT_COLORS, type EventDraft } from './EventDialog.tsx';
import { EventPopover } from './EventPopover.tsx';
import { Grid, HOUR_HEIGHT, HOUR_START, type GridColumn } from './Grid.tsx';
import { PresenceDialog } from './PresenceDialog.tsx';
import { Sidebar } from './Sidebar.tsx';
import { storage } from './storage.ts';

const HIDDEN_KEY = 'taxi-crm:hidden-drivers';

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

function SearchBox({ onEvent, onClient }: { onEvent: (e: AgendaEvent) => void; onClient: (c: Client) => void }) {
  const { isAdmin } = useSession();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data: clients = [] } = useClients();
  const { data: drivers } = useDrivers();

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const close = (e: globalThis.MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const { data: hits = [] } = useQuery({
    queryKey: ['events', 'search', query],
    queryFn: () => api.get<AgendaEvent[]>(`/api/events/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });
  const matchingClients =
    isAdmin && query.length >= 2
      ? clients.filter((c) => normalize(`${clientLabel(c)} ${c.tel}`).includes(normalize(query))).slice(0, 10)
      : [];
  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="search" ref={box}>
      <input
        id="search"
        placeholder="Recherche par nom et prénom"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.length >= 2 && (
        <div id="results">
          {!hits.length && !matchingClients.length && <div className="none">Aucun résultat</div>}
          {matchingClients.map((c) => (
            <button key={c.id} onClick={() => pick(() => onClient(c))}>
              {clientLabel(c)} <small>{c.tel} — fiche client</small>
            </button>
          ))}
          {hits.map((e) => {
            const d = fromIso(e.date);
            const driver = drivers.find((x) => x.id === e.driverId);
            return (
              <button key={e.id} onClick={() => pick(() => onEvent(e))}>
                {e.title}{' '}
                <small>
                  — {longDate(d)} {d.getFullYear()}, {formatTime(e.start)}
                  {driver && isAdmin ? ` · ${driver.name}` : ''}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AgendaPage() {
  const { user, isAdmin, logout } = useSession();
  const { alert, run } = useDialogs();
  const print = usePrint();
  const { data: drivers } = useDrivers();
  const { data: settings } = useSettings();
  const circuits = useCircuitIndex();

  const [view, setView] = useState<'day' | 'week'>(isAdmin ? 'day' : 'week');
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(() => new Date(day.getFullYear(), day.getMonth(), 1));
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [hiddenDrivers, setHiddenState] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(storage.get(HIDDEN_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const setHiddenDrivers = (next: Set<string>) => {
    setHiddenState(next);
    storage.set(HIDDEN_KEY, JSON.stringify([...next]));
  };

  const [popover, setPopover] = useState<{ item: GridItem; anchor: { x: number; y: number } } | null>(null);
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [presenceOf, setPresenceOf] = useState<AgendaEvent | null>(null);
  const [clientsOpen, setClientsOpen] = useState<{ client: Client | null } | null>(null);
  const [circuitsOpen, setCircuitsOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  const scroll = useRef<HTMLDivElement>(null);

  const viewDays = useMemo(
    () => (view === 'week' ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(monday(day), i)) : [day]),
    [view, day],
  );
  const from = toIso(viewDays[0]!);
  const to = toIso(viewDays.at(-1)!);
  const { data: events = [] } = useEvents(from, to);

  const shownDrivers = useMemo(
    () => (isAdmin ? drivers.filter((d) => !hiddenDrivers.has(d.id)) : drivers.filter((d) => d.id === user.id)),
    [isAdmin, drivers, hiddenDrivers, user.id],
  );
  const driverName = useCallback((id: string) => drivers.find((d) => d.id === id)?.name ?? '', [drivers]);

  const go = useCallback((d: Date) => {
    setMenuOpen(false);
    setDay(d);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, []);

  /** Affiche une course précise, y compris si son chauffeur était masqué. */
  const showEvent = useCallback(
    (e: { id: string; date: string; driverId: string; start?: number }) => {
      if (hiddenDrivers.has(e.driverId)) {
        const next = new Set(hiddenDrivers);
        next.delete(e.driverId);
        setHiddenDrivers(next);
      }
      setHighlightId(e.id);
      go(fromIso(e.date));
      if (e.start != null && scroll.current) {
        scroll.current.scrollTop = Math.max(0, ((e.start - HOUR_START * 60) / 60) * HOUR_HEIGHT - 80);
      }
    },
    [hiddenDrivers, go],
  );

  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 2 * HOUR_HEIGHT;
  }, []);

  const todayIso = toIso(new Date());
  const columns: GridColumn[] =
    view === 'day'
      ? shownDrivers.map((d) => ({
          key: d.id,
          label: shownDrivers.length > 1 || isAdmin ? d.name : shortDate(day),
          date: toIso(day),
          driverIds: [d.id],
          isToday: toIso(day) === todayIso,
        }))
      : shownDrivers.length
        ? viewDays.map((d) => ({
            key: toIso(d),
            label: shortDate(d),
            date: toIso(d),
            driverIds: shownDrivers.map((x) => x.id),
            isToday: toIso(d) === todayIso,
          }))
        : [];

  const itemsFor = useCallback(
    (column: GridColumn) =>
      groupTours(
        events.filter((e) => e.date === column.date && column.driverIds.includes(e.driverId)),
        isAdmin,
        circuits,
      ),
    [events, isAdmin, circuits],
  );

  const openNew = (over: Partial<EventDraft> = {}) => {
    const fallback = isAdmin ? (shownDrivers[0] ?? drivers[0]) : drivers[0];
    if (!fallback) {
      void alert("Ajoutez d'abord un chauffeur.");
      return;
    }
    setPopover(null);
    setEventDraft({
      driverId: fallback.id,
      date: toIso(day),
      start: 8 * 60,
      end: 9 * 60,
      title: '',
      notes: '',
      color: EVENT_COLORS[0]!,
      ...over,
    });
  };

  const onMove = (item: GridItem, column: GridColumn, shift: number) => {
    const driverId = view === 'day' ? column.driverIds[0]! : item.driverId;
    if (driverId === item.driverId && column.date === item.date && !shift) return;
    const ids = isGroup(item) ? item.group.map((e) => e.id) : [item.id];
    setPopover(null);
    void run(() => api.post('/api/events/move', { ids, driverId, date: column.date, shift }));
  };

  const printView = async () => {
    const list = await api.get<AgendaEvent[]>(`/api/events?from=${from}&to=${to}`);
    const sheet = buildAgendaSheet({
      options: { from, to, driverIds: shownDrivers.map((d) => d.id), what: null, order: 'day', showEmpty: true },
      events: list,
      drivers,
      companyName: settings?.companyName ?? '',
      isAdmin,
      circuits,
    });
    print(sheet);
  };

  const step = view === 'week' ? 7 : 1;
  const start = monday(day);
  const style = { '--minw': `${columns.length > 1 ? columns.length * 120 + 40 : 0}px` } as CSSProperties;

  const onOpenItem = (item: GridItem, e: MouseEvent) => {
    setPopover({ item, anchor: { x: e.clientX, y: e.clientY } });
  };

  // le contenu de la bulle reste à jour après un rafraîchissement ou une modification
  const liveItem = popover
    ? isGroup(popover.item)
      ? popover.item
      : (events.find((e) => e.id === popover.item.id) ?? popover.item)
    : null;

  return (
    <div className={`app${menuOpen ? ' menu' : ''}`}>
      <div id="topbar">
        <button id="menu" title="Calendrier et agendas" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}>
          ☰
        </button>
        <SearchBox onEvent={(e) => showEvent(e)} onClient={(client) => setClientsOpen({ client })} />
        <div id="user">
          <span id="who">{isAdmin ? 'Gérant' : user.name}</span>
          <button onClick={() => void logout()}>Déconnexion</button>
        </div>
      </div>
      <div id="layout">
        <Sidebar
          month={month}
          day={day}
          weekView={view === 'week'}
          onMonth={setMonth}
          onSelect={go}
          hiddenDrivers={hiddenDrivers}
          setHiddenDrivers={setHiddenDrivers}
          highlightId={highlightId}
          onShowEvent={showEvent}
        />
        <main id="main" onMouseDown={() => setMenuOpen(false)}>
          <div id="toolbar">
            <button onClick={() => go(today())}>Aujourd'hui</button>
            <button aria-label="Précédent" onClick={() => go(addDays(day, -step))}>
              ◀
            </button>
            <button aria-label="Suivant" onClick={() => go(addDays(day, step))}>
              ▶
            </button>
            <div id="title">
              {view === 'day' ? (
                <>
                  Le{' '}
                  <b>
                    {WEEKDAYS[day.getDay()]} {longDate(day)}
                  </b>
                </>
              ) : (
                <>
                  Semaine du{' '}
                  <b>
                    {longDate(start)} au {longDate(addDays(start, 6))}
                  </b>
                </>
              )}
            </div>
            <div className="sp" />
            <button className={view === 'day' ? 'on' : undefined} onClick={() => setView('day')}>
              Jour
            </button>
            <button className={view === 'week' ? 'on' : undefined} onClick={() => setView('week')}>
              7 jours
            </button>
            {isAdmin && <button onClick={() => setClientsOpen({ client: null })}>Clients</button>}
            {isAdmin && <button onClick={() => setCircuitsOpen(true)}>Circuits</button>}
            {isAdmin && <button onClick={() => setBillingOpen(true)}>Facturation</button>}
            {user.canAdd && <button onClick={() => openNew()}>+ Nouveau RDV</button>}
            <button onClick={() => (isAdmin ? setPrintOpen(true) : void printView())}>Imprimer</button>
          </div>
          <div id="wrap" style={style}>
            <div id="heads">
              {columns.map((c) => (
                <div key={c.key} className={view === 'week' && c.isToday ? 'td' : undefined}>
                  {c.label}
                </div>
              ))}
            </div>
            <div id="scroll" ref={scroll}>
              <Grid
                columns={columns}
                itemsFor={itemsFor}
                circuits={circuits}
                isAdmin={isAdmin}
                canAdd={user.canAdd}
                driverName={driverName}
                highlightId={highlightId}
                onCreate={(column, a, b) =>
                  openNew({ driverId: column.driverIds[0]!, date: column.date, start: a, end: b })
                }
                onOpen={onOpenItem}
                onMove={onMove}
              />
            </div>
            <div id="foot">
              {columns.map((c) => (
                <div key={c.key}>
                  {itemsFor(c).length} <small>RDV</small>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>

      {popover && liveItem && (
        <EventPopover
          item={liveItem}
          anchor={popover.anchor}
          circuits={circuits}
          driverName={driverName}
          onClose={() => setPopover(null)}
          onEdit={(event) => {
            setPopover(null);
            setEventDraft(event);
          }}
          onPresence={(event) => {
            setPopover(null);
            setPresenceOf(event);
          }}
        />
      )}
      {eventDraft && (
        <EventDialog
          draft={eventDraft}
          onClose={() => setEventDraft(null)}
          onSaved={(date) => {
            setEventDraft(null);
            go(fromIso(date));
          }}
        />
      )}
      {presenceOf && <PresenceDialog event={presenceOf} circuits={circuits} onClose={() => setPresenceOf(null)} />}
      {clientsOpen && (
        <ClientsDialog
          initial={clientsOpen.client}
          onClose={() => setClientsOpen(null)}
          onShowEvent={(e) => {
            setClientsOpen(null);
            showEvent(e);
          }}
        />
      )}
      {circuitsOpen && <CircuitsDialog onClose={() => setCircuitsOpen(false)} />}
      {billingOpen && (
        <BillingDialog
          onClose={() => setBillingOpen(false)}
          onShowEvent={(target) => {
            setBillingOpen(false);
            setView('day');
            showEvent(target);
          }}
        />
      )}
      {printOpen && (
        <PrintDialog
          day={day}
          viewDays={viewDays}
          shownDriverIds={shownDrivers.map((d) => d.id)}
          circuits={circuits}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </div>
  );
}
