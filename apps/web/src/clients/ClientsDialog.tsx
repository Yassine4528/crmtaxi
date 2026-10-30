import {
  clientLabel,
  formatTime,
  fromIso,
  normalize,
  STATUS_LABELS,
  toIso,
  type AgendaEvent,
  type Client,
} from '@taxi-crm/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../api/client.ts';
import { useClients, useDrivers } from '../api/hooks.ts';
import { useDialogs } from '../components/Dialogs.tsx';
import { Modal } from '../components/Modal.tsx';

interface ClientsDialogProps {
  onClose: () => void;
  /** Fiche créée depuis la fenêtre de rendez-vous : on la renvoie et on referme. */
  onCreated?: (client: Client) => void;
  startNew?: boolean;
  initial?: Client | null;
  onShowEvent?: (event: AgendaEvent) => void;
}

const formatEvent = (e: AgendaEvent | undefined) =>
  e ? `${fromIso(e.date).toLocaleDateString('fr-FR')} à ${formatTime(e.start)}` : 'aucun';

function ClientHistory({ client, onShowEvent }: { client: Client; onShowEvent?: (event: AgendaEvent) => void }) {
  const { data: events = [] } = useQuery({
    queryKey: ['clients', client.id, 'events'],
    queryFn: () => api.get<AgendaEvent[]>(`/api/clients/${client.id}/events`),
  });
  const { data: drivers } = useDrivers();
  const today = toIso(new Date());
  const name = (id: string) => drivers.find((d) => d.id === id)?.name ?? '';
  return (
    <div className="stats">
      <div>Dernier rdv : {formatEvent(events.filter((e) => e.date < today).at(-1))}</div>
      <div>Prochain rdv : {formatEvent(events.find((e) => e.date >= today))}</div>
      <div className="strong">
        {events.length} rendez-vous au total{events.length ? ' :' : ''}
      </div>
      {events
        .slice(-60)
        .reverse()
        .map((e) => (
          <button key={e.id} type="button" className="lnk tight" onClick={() => onShowEvent?.(e)}>
            {formatEvent(e)} — {name(e.driverId)}
            {e.status ? ` (${STATUS_LABELS[e.status]})` : ''}
          </button>
        ))}
    </div>
  );
}

const EMPTY = { nom: '', prenom: '', tel: '', address: '', notes: '' };

export function ClientsDialog({ onClose, onCreated, startNew, initial, onShowEvent }: ClientsDialogProps) {
  const { data: clients = [] } = useClients();
  const queryClient = useQueryClient();
  const { confirm, run } = useDialogs();
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<Client | null>(startNew ? null : (initial ?? null));
  const [form, setForm] = useState(current ?? EMPTY);
  const [error, setError] = useState('');

  const select = (client: Client | null) => {
    setCurrent(client);
    setForm(client ?? EMPTY);
    setError('');
  };

  const query = normalize(search);
  const list = clients
    .filter((c) => normalize(`${clientLabel(c)} ${c.tel} ${c.address}`).includes(query))
    .sort((a, b) => clientLabel(a).localeCompare(clientLabel(b), 'fr'));

  const save = async () => {
    try {
      const saved = current
        ? await api.put<Client>(`/api/clients/${current.id}`, form)
        : await api.post<Client>('/api/clients', form);
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      if (onCreated) {
        onCreated(saved);
        return;
      }
      select(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Une erreur est survenue.');
    }
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirm(`Supprimer la fiche de ${clientLabel(current)} ? Ses rendez-vous restent dans l'agenda.`, {
      danger: true,
    });
    if (ok && (await run(() => api.delete(`/api/clients/${current.id}`)))) select(null);
  };

  return (
    <Modal title="Fichier clients" width={780} onClose={onClose}>
      <div className="row">
        <div>
          <input
            type="text"
            placeholder="Recherche par nom, prénom, téléphone"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="client-list">
            {!list.length && (
              <div className="empty">{clients.length ? 'Aucun résultat' : 'Aucune fiche pour le moment'}</div>
            )}
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === current?.id ? 'on' : undefined}
                onClick={() => select(c)}
              >
                {clientLabel(c)} <small>{c.tel}</small>
              </button>
            ))}
          </div>
          <button type="button" className="lnk" onClick={() => select(null)}>
            + Ajouter une fiche client
          </button>
        </div>
        <form
          className="grow13"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="row">
            <div>
              <label>Nom</label>
              <input
                type="text"
                required
                data-autofocus={!current || undefined}
                value={form.nom}
                onChange={(e) => setForm({ ...form, nom: e.target.value })}
              />
            </div>
            <div>
              <label>Prénom</label>
              <input type="text" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
            </div>
          </div>
          <label>Téléphone</label>
          <input
            type="text"
            inputMode="tel"
            value={form.tel}
            onChange={(e) => setForm({ ...form, tel: e.target.value })}
          />
          <label>Adresse</label>
          <textarea
            className="short"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <label>Notes</label>
          <textarea
            className="short"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          {current ? (
            <ClientHistory client={current} onShowEvent={onShowEvent} />
          ) : (
            <div className="stats">Nouvelle fiche : remplissez puis cliquez sur Enregistrer.</div>
          )}
          <div className="err">{error}</div>
          <div className="btns">
            {current && (
              <button type="button" onClick={() => void remove()}>
                Supprimer la fiche
              </button>
            )}
            <button type="button" onClick={onClose}>
              Fermer
            </button>
            <button className="p">Enregistrer</button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
