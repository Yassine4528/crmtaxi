import {
  capitalize,
  clientLabel,
  fromIso,
  fromTimeInput,
  normalize,
  toIso,
  toTimeInput,
  WEEKDAYS,
  type Client,
} from '@taxi-crm/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../api/client.ts';
import { useClients, useDrivers } from '../api/hooks.ts';
import { ClientsDialog } from '../clients/ClientsDialog.tsx';
import { Modal } from '../components/Modal.tsx';
import { useSession } from '../session.tsx';

export const EVENT_COLORS = ['#d9d9d9', '#ff5a1f', '#f6c443', '#8fd19e', '#8cc4ee', '#d9a8e8', '#f2a0a0'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export interface EventDraft {
  id?: string;
  driverId: string;
  date: string;
  start: number;
  end: number;
  title: string;
  notes: string;
  color: string;
  clientId?: string | null;
  seriesId?: string | null;
}

interface EventDialogProps {
  draft: EventDraft;
  onClose: () => void;
  /** Appelé après enregistrement, avec la date à afficher. */
  onSaved: (date: string) => void;
}

export function EventDialog({ draft, onClose, onSaved }: EventDialogProps) {
  const { isAdmin, user } = useSession();
  const queryClient = useQueryClient();
  const { data: drivers } = useDrivers();
  const { data: clients = [] } = useClients();
  const isNew = !draft.id;

  const initialClient = clients.find((c) => c.id === draft.clientId);
  const [clientText, setClientText] = useState(initialClient ? clientLabel(initialClient) : '');
  const [title, setTitle] = useState(draft.title);
  const [date, setDate] = useState(draft.date);
  const [driverId, setDriverId] = useState(isAdmin ? draft.driverId : user.id);
  const [start, setStart] = useState(toTimeInput(draft.start));
  const [end, setEnd] = useState(toTimeInput(draft.end));
  const [notes, setNotes] = useState(draft.notes);
  const [color, setColor] = useState(draft.color || EVENT_COLORS[0]!);
  const [applyToFollowing, setApplyToFollowing] = useState(false);
  const [error, setError] = useState('');
  const [newClient, setNewClient] = useState(false);

  const [recurring, setRecurring] = useState(false);
  const [every, setEvery] = useState(1);
  const firstDay = fromIso(draft.date);
  const [weekdays, setWeekdays] = useState<number[]>([firstDay.getDay()]);
  const [endMode, setEndMode] = useState<'until' | 'count'>('until');
  const [count, setCount] = useState(10);
  const [until, setUntil] = useState(
    toIso(new Date(firstDay.getFullYear(), firstDay.getMonth() + 3, firstDay.getDate())),
  );

  const findClient = (text: string, list: Client[] = clients) =>
    list.find((c) => normalize(clientLabel(c)) === normalize(text));

  const submit = async () => {
    const s = fromTimeInput(start);
    const f = fromTimeInput(end);
    if (f <= s) {
      setError("L'heure de fin doit être après l'heure de début.");
      return;
    }
    const typed = clientText.trim();
    const client = typed ? findClient(typed) : undefined;
    if (typed && !client) {
      setError('Fiche client introuvable : choisissez-la dans la liste ou créez-la avec « + Nouvelle fiche ».');
      return;
    }
    const fields = {
      driverId,
      date,
      start: s,
      end: f,
      title: title.trim(),
      notes: notes.trim(),
      color,
      clientId: isAdmin ? (client?.id ?? null) : null,
    };
    try {
      let shownDate = date;
      if (isNew) {
        const recurrence = recurring
          ? {
              every,
              weekdays,
              ...(endMode === 'count' ? { count } : { until }),
            }
          : undefined;
        const res = await api.post<{ firstDate: string }>('/api/events', {
          ...fields,
          ...(recurrence ? { recurrence } : {}),
        });
        shownDate = res.firstDate;
      } else {
        await api.put(`/api/events/${draft.id}`, { ...fields, applyToFollowing });
      }
      await queryClient.invalidateQueries();
      onSaved(shownDate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    }
  };

  return (
    <>
      <Modal
        title={isNew ? 'Nouveau rendez-vous' : 'Modifier le rendez-vous'}
        onClose={onClose}
        onSubmit={() => void submit()}
      >
        {isAdmin && (
          <>
            <label>Fiche client</label>
            <div className="row">
              <div className="grow3">
                <input
                  type="text"
                  list="clientOptions"
                  placeholder="Rechercher par nom et prénom"
                  autoComplete="off"
                  value={clientText}
                  onChange={(e) => {
                    setClientText(e.target.value);
                    const c = findClient(e.target.value);
                    if (c && !title.trim()) setTitle(clientLabel(c));
                  }}
                />
              </div>
              <div>
                <button type="button" className="sm" onClick={() => setNewClient(true)}>
                  + Nouvelle fiche
                </button>
              </div>
            </div>
            <datalist id="clientOptions">
              {clients.map((c) => (
                <option key={c.id} value={clientLabel(c)} label={c.tel} />
              ))}
            </datalist>
          </>
        )}
        <label>Intitulé du rendez-vous</label>
        <input type="text" required data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="row">
          <div>
            <label>Date</label>
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label>Chauffeur</label>
            <select value={driverId} disabled={!isAdmin} onChange={(e) => setDriverId(e.target.value)}>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div>
            <label>Début</label>
            <input type="time" step={300} required value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label>Fin</label>
            <input type="time" step={300} required value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {isNew && (
          <>
            <label className="chk">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} /> Récurrence
            </label>
            {recurring && (
              <div className="rec">
                <div className="rl">
                  <span>Toutes les</span>
                  <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                    {[1, 2, 3, 4].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>{' '}
                  semaine(s)
                </div>
                <div className="rl">
                  <span>Le :</span>
                  <div className="rec-days">
                    {WEEK_ORDER.map((n) => (
                      <label key={n}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(n)}
                          onChange={(e) =>
                            setWeekdays(e.target.checked ? [...weekdays, n] : weekdays.filter((w) => w !== n))
                          }
                        />
                        {capitalize(WEEKDAYS[n]!).slice(0, 3)}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rl">
                  <span>Se termine :</span>
                  <div>
                    <label className="chk inline">
                      <input type="radio" checked={endMode === 'count'} onChange={() => setEndMode('count')} /> Après{' '}
                      <input
                        type="number"
                        min={1}
                        max={400}
                        value={count}
                        onChange={(e) => setCount(Math.floor(Number(e.target.value)))}
                      />{' '}
                      répétitions
                    </label>
                    <label className="chk inline">
                      <input type="radio" checked={endMode === 'until'} onChange={() => setEndMode('until')} /> Jusqu'au{' '}
                      <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                    </label>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {!isNew && draft.seriesId && (
          <label className="chk">
            <input type="checkbox" checked={applyToFollowing} onChange={(e) => setApplyToFollowing(e.target.checked)} />{' '}
            Appliquer aussi aux rendez-vous suivants de la série (sauf la date)
          </label>
        )}
        <label>Notes (adresse, téléphone, BT…)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        <label>Couleur</label>
        <div className="colors">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Couleur ${c}`}
              className={c === color ? 'on' : undefined}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <div className="err">{error}</div>
        <div className="btns">
          <button type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="p">Enregistrer</button>
        </div>
      </Modal>
      {newClient && (
        <ClientsDialog
          onClose={() => setNewClient(false)}
          onCreated={(client) => {
            setClientText(clientLabel(client));
            if (!title.trim()) setTitle(clientLabel(client));
            setNewClient(false);
          }}
          startNew
        />
      )}
    </>
  );
}
