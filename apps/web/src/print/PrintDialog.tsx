import {
  addDays,
  daysBetween,
  formatTime,
  fromIso,
  fullDate,
  monday,
  STATUS_LABELS,
  toIso,
  type AgendaEvent,
} from '@taxi-crm/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError, api } from '../api/client.ts';
import { useDrivers, useFullCircuits, useSettings, type CircuitIndex } from '../api/hooks.ts';
import { groupTours, isGroup, itemText, type GridItem } from '../agenda/display.ts';
import { Modal } from '../components/Modal.tsx';
import { useSession } from '../session.tsx';
import { usePrint } from './PrintProvider.tsx';

const MAX_DAYS = 62;
const RDV = 'rdv';

export interface PrintOptions {
  from: string;
  to: string;
  driverIds: string[];
  /** `null` = tout ; sinon `rdv` et/ou identifiants de circuits. */
  what: Set<string> | null;
  order: 'day' | 'driver';
  showEmpty: boolean;
}

interface PrintContext {
  options: PrintOptions;
  events: AgendaEvent[];
  drivers: { id: string; name: string }[];
  companyName: string;
  isAdmin: boolean;
  circuits: CircuitIndex;
}

/** Feuille de route : une case à cocher par course. Retourne `null` s'il n'y a rien à imprimer. */
export function buildAgendaSheet(ctx: PrintContext): ReactNode {
  const { options, events, drivers, companyName, isAdmin, circuits } = ctx;
  const keep = (e: AgendaEvent) => !options.what || options.what.has(e.circuitId ?? RDV);
  const selected = drivers.filter((d) => options.driverIds.includes(d.id));
  const days: Date[] = [];
  for (let d = fromIso(options.from); d <= fromIso(options.to); d = addDays(d, 1)) days.push(d);
  const itemsOf = (driverId: string, date: string) =>
    groupTours(
      events.filter((e) => e.driverId === driverId && e.date === date && keep(e)),
      isAdmin,
      circuits,
    ).sort((a, b) => a.start - b.start);

  const now = new Date();
  const whatNames = options.what
    ? [...options.what]
        .map((w) => (w === RDV ? 'Rendez-vous' : circuits.get(w)?.name))
        .filter(Boolean)
        .join(' · ')
    : '';
  const head = (
    <>
      <div className="pd">
        Imprimé le {fullDate(now)} à {formatTime(now.getHours() * 60 + now.getMinutes())}.
      </div>
      <div className="pbiz">{companyName}</div>
      {whatNames && <div className="psel">{whatNames}</div>}
    </>
  );

  const lines = (items: GridItem[]) => (
    <div className="pbox">
      {items.map((item) => {
        const tel = !isGroup(item) && item.client?.tel;
        return (
          <div key={item.id} className={`pl${item.status ? ' st' : ''}`}>
            <span className="ck" />
            <b>
              {formatTime(item.start)} à {formatTime(item.end)} :
            </b>{' '}
            {itemText(item, isAdmin, circuits).replace(/\n/g, ' — ')}
            {tel ? ` — ☎ ${tel}` : ''}
            {item.status ? ` (${STATUS_LABELS[item.status]})` : ''}
          </div>
        );
      })}
    </div>
  );

  let count = 0;
  let body: ReactNode;
  if (options.order === 'driver') {
    body = selected.map((driver) => {
      const blocks = days
        .map((d) => [d, itemsOf(driver.id, toIso(d))] as const)
        .filter(([, items]) => options.showEmpty || items.length);
      if (!blocks.length) return null;
      return (
        <section key={driver.id} className="pdrv">
          {head}
          <div className="pday">{driver.name.toUpperCase()}</div>
          {blocks.map(([d, items]) => {
            count += items.length;
            return (
              <div key={toIso(d)}>
                <div className="pag">{fullDate(d)}</div>
                {lines(items)}
              </div>
            );
          })}
        </section>
      );
    });
  } else {
    body = (
      <>
        {head}
        {days.map((d) => {
          const blocks = selected
            .map((driver) => [driver, itemsOf(driver.id, toIso(d))] as const)
            .filter(([, items]) => options.showEmpty || items.length);
          if (!blocks.length) return null;
          return (
            <div key={toIso(d)}>
              <div className="pday">{fullDate(d)}</div>
              {blocks.map(([driver, items]) => {
                count += items.length;
                return (
                  <div key={driver.id}>
                    <div className="pag">{driver.name.toUpperCase()}</div>
                    {lines(items)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </>
    );
  }
  return !count && !options.showEmpty ? null : body;
}

function CheckGrid(props: {
  items: { id: string; label: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="chk-grid">
      {props.items.map((item) => (
        <label key={item.id}>
          <input
            type="checkbox"
            checked={props.selected.has(item.id)}
            onChange={(e) => {
              const next = new Set(props.selected);
              if (e.target.checked) next.add(item.id);
              else next.delete(item.id);
              props.onChange(next);
            }}
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}

interface PrintDialogProps {
  day: Date;
  viewDays: Date[];
  shownDriverIds: string[];
  circuits: CircuitIndex;
  onClose: () => void;
}

/** Impression à la carte du gérant : période, chauffeurs, rendez-vous et/ou circuits choisis. */
export function PrintDialog({ day, viewDays, shownDriverIds, circuits, onClose }: PrintDialogProps) {
  const { isAdmin } = useSession();
  const queryClient = useQueryClient();
  const print = usePrint();
  const { data: drivers } = useDrivers();
  const { data: settings } = useSettings();
  const fullCircuits = useFullCircuits();
  const whatItems = [
    { id: RDV, label: 'Rendez-vous (hors circuits)' },
    ...fullCircuits.map((c) => ({ id: c.id, label: c.name })),
  ];

  const [from, setFrom] = useState(toIso(viewDays[0]!));
  const [to, setTo] = useState(toIso(viewDays.at(-1)!));
  const [driverIds, setDriverIds] = useState(new Set(shownDriverIds));
  const [what, setWhat] = useState(new Set(whatItems.map((w) => w.id)));
  const [order, setOrder] = useState<PrintOptions['order']>('day');
  const [showEmpty, setShowEmpty] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!from || !to || to < from) return setError('Choisissez une période valide.');
    if (daysBetween(fromIso(from), fromIso(to)) > MAX_DAYS)
      return setError('Période trop longue : deux mois au maximum.');
    if (!driverIds.size) return setError('Cochez au moins un chauffeur.');
    if (!what.size) return setError('Cochez au moins une chose à imprimer.');
    try {
      const events = await queryClient.fetchQuery({
        queryKey: ['events', from, to],
        queryFn: () => api.get<AgendaEvent[]>(`/api/events?from=${from}&to=${to}`),
      });
      const sheet = buildAgendaSheet({
        options: {
          from,
          to,
          driverIds: [...driverIds],
          what: what.size === whatItems.length ? null : what,
          order,
          showEmpty,
        },
        events,
        drivers,
        companyName: settings?.companyName ?? '',
        isAdmin,
        circuits,
      });
      if (!sheet) return setError('Rien à imprimer avec ces choix sur cette période.');
      onClose();
      print(sheet);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    }
  };

  const week = monday(day);
  return (
    <Modal title="Imprimer" width={600} onClose={onClose} onSubmit={() => void submit()}>
      <div className="row">
        <div>
          <label>Du</label>
          <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label>Au</label>
          <input type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <div className="btns left compact">
        <button
          type="button"
          onClick={() => {
            setFrom(toIso(day));
            setTo(toIso(day));
          }}
        >
          Jour affiché
        </button>
        <button
          type="button"
          onClick={() => {
            setFrom(toIso(week));
            setTo(toIso(addDays(week, 6)));
          }}
        >
          Semaine affichée
        </button>
        <button
          type="button"
          onClick={() => {
            setFrom(toIso(new Date(day.getFullYear(), day.getMonth(), 1)));
            setTo(toIso(new Date(day.getFullYear(), day.getMonth() + 1, 0)));
          }}
        >
          Mois affiché
        </button>
      </div>
      <label>
        Chauffeurs{' '}
        <button type="button" className="mini" onClick={() => setDriverIds(new Set(drivers.map((d) => d.id)))}>
          tous
        </button>{' '}
        ·{' '}
        <button type="button" className="mini" onClick={() => setDriverIds(new Set())}>
          aucun
        </button>
      </label>
      <CheckGrid
        items={drivers.map((d) => ({ id: d.id, label: d.name }))}
        selected={driverIds}
        onChange={setDriverIds}
      />
      <label>
        Quoi imprimer{' '}
        <button type="button" className="mini" onClick={() => setWhat(new Set(whatItems.map((w) => w.id)))}>
          tout
        </button>{' '}
        ·{' '}
        <button type="button" className="mini" onClick={() => setWhat(new Set())}>
          rien
        </button>
      </label>
      <CheckGrid items={whatItems} selected={what} onChange={setWhat} />
      <label>Présentation</label>
      <select value={order} onChange={(e) => setOrder(e.target.value as PrintOptions['order'])}>
        <option value="day">Jour par jour, puis chauffeur par chauffeur</option>
        <option value="driver">Une feuille par chauffeur, jour par jour</option>
      </select>
      <label className="chk">
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> Afficher aussi
        les jours et chauffeurs sans course
      </label>
      <div className="err">{error}</div>
      <div className="btns">
        <button type="button" onClick={onClose}>
          Annuler
        </button>
        <button className="p">Imprimer</button>
      </div>
    </Modal>
  );
}
