import {
  capitalize,
  circuitPeriods,
  DEFAULT_COURSE_COLORS,
  emptyCircuitConfig,
  formatAmountInput,
  formatTripRiders,
  fromIso,
  fromTimeInput,
  parseAmount,
  parseRiderNames,
  parseTripRiders,
  PERIOD_LABELS,
  planKey,
  rateFor,
  ridersKey,
  toIso,
  toTimeInput,
  WEEKDAYS,
  WORK_WEEKDAYS,
  type Circuit,
  type CircuitInput,
  type Period,
} from '@taxi-crm/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { useDrivers, useFullCircuits, useSettings } from '../api/hooks.ts';
import { CommitInput, CommitTextarea } from '../components/CommitInput.tsx';
import { useDialogs } from '../components/Dialogs.tsx';
import { Modal } from '../components/Modal.tsx';

type Mutate = (mutator: (circuit: Circuit) => void) => void;

const dayName = (wd: number) => capitalize(WEEKDAYS[wd]!);

function PerRunPlan({ circuit, mutate }: { circuit: Circuit; mutate: Mutate }) {
  const { config } = circuit;
  const periods = circuitPeriods(config).filter((p) => p !== 'jour');

  const learn = (c: Circuit, period: Period, key: string) => {
    const slot = c.config.plan[key];
    if (slot) c.config.rates[`${period}|${ridersKey(slot.riders)}`] = { price: slot.price, surcharge: slot.surcharge };
  };

  return (
    <div className="scroll-x">
      <table className="plan">
        <thead>
          <tr>
            <th />
            {periods.map((p) => (
              <th key={p} colSpan={4}>
                {capitalize(PERIOD_LABELS[p])} · € TTC · + suppl. · Horaire
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WORK_WEEKDAYS.map((wd) => (
            <tr key={wd}>
              <td>{dayName(wd)}</td>
              {periods.map((period) => {
                const key = planKey(wd, period);
                const slot = config.plan[key];
                const defaultHours = config.hours[period]!;
                return (
                  <PlanCells
                    key={key}
                    slotText={slot ? slot.riders.join(' - ') : ''}
                    price={slot ? formatAmountInput(slot.price) : ''}
                    surcharge={slot?.surcharge ? formatAmountInput(slot.surcharge) : ''}
                    hours={slot?.hours ? `${toTimeInput(slot.hours[0])}-${toTimeInput(slot.hours[1])}` : ''}
                    hoursPlaceholder={`${toTimeInput(defaultHours[0])}-${toTimeInput(defaultHours[1])}`}
                    onRiders={(text) =>
                      mutate((c) => {
                        const names = parseRiderNames(text);
                        if (!names.length) {
                          delete c.config.plan[key];
                          return;
                        }
                        const known = rateFor(c, period, names);
                        const old = c.config.plan[key];
                        c.config.plan[key] = {
                          riders: names,
                          price: known ? known.price : (old?.price ?? 0),
                          surcharge: known ? known.surcharge : (old?.surcharge ?? 0),
                          ...(old?.hours ? { hours: old.hours } : {}),
                        };
                      })
                    }
                    onPrice={(text) =>
                      mutate((c) => {
                        const s = c.config.plan[key];
                        if (!s) return;
                        s.price = parseAmount(text);
                        learn(c, period, key);
                      })
                    }
                    onSurcharge={(text) =>
                      mutate((c) => {
                        const s = c.config.plan[key];
                        if (!s) return;
                        s.surcharge = parseAmount(text);
                        learn(c, period, key);
                      })
                    }
                    onHours={(text) =>
                      mutate((c) => {
                        const s = c.config.plan[key];
                        if (!s) return;
                        const m = text.match(/(\d{1,2})[:h](\d{2})\s*-\s*(\d{1,2})[:h](\d{2})/);
                        if (m) s.hours = [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
                        else delete s.hours;
                      })
                    }
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlanCells(props: {
  slotText: string;
  price: string;
  surcharge: string;
  hours: string;
  hoursPlaceholder: string;
  onRiders: (v: string) => void;
  onPrice: (v: string) => void;
  onSurcharge: (v: string) => void;
  onHours: (v: string) => void;
}) {
  return (
    <>
      <td>
        <CommitInput className="nm" placeholder="pas de course" value={props.slotText} onCommit={props.onRiders} />
      </td>
      <td>
        <CommitInput className="num" value={props.price} onCommit={props.onPrice} />
      </td>
      <td>
        <CommitInput className="num" value={props.surcharge} onCommit={props.onSurcharge} />
      </td>
      <td>
        <CommitInput className="hr" placeholder={props.hoursPlaceholder} value={props.hours} onCommit={props.onHours} />
      </td>
    </>
  );
}

function PerRiderTables({ circuit, mutate }: { circuit: Circuit; mutate: Mutate }) {
  const { data: drivers } = useDrivers();
  const { config } = circuit;
  const rates = config.conventionRates
    .map((rate, index) => ({ rate, index }))
    .sort((a, b) => a.rate.name.localeCompare(b.rate.name, 'fr') || a.rate.weekday - b.rate.weekday);
  const trips = [...config.trips].sort((a, b) => a.weekday - b.weekday || a.start - b.start);

  return (
    <>
      <label>
        Tarifs des conventions — prix TTC par jeune et par jour (compté une seule fois par jour, aller et retour
        compris)
      </label>
      <table className="plan">
        <thead>
          <tr>
            {['Jeune', 'Jour', 'Précision', 'Prix TTC', ''].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rates.map(({ rate, index }) => (
            <tr key={index}>
              <td>
                <CommitInput
                  value={rate.name}
                  onCommit={(v) => {
                    if (v.trim()) mutate((c) => void (c.config.conventionRates[index]!.name = v.trim()));
                  }}
                />
              </td>
              <td>
                <select
                  value={rate.weekday}
                  onChange={(e) =>
                    mutate((c) => void (c.config.conventionRates[index]!.weekday = Number(e.target.value)))
                  }
                >
                  {WORK_WEEKDAYS.map((w) => (
                    <option key={w} value={w}>
                      {dayName(w)}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <CommitInput
                  value={rate.label}
                  onCommit={(v) => mutate((c) => void (c.config.conventionRates[index]!.label = v.trim()))}
                />
              </td>
              <td>
                <CommitInput
                  className="num"
                  value={formatAmountInput(rate.price)}
                  onCommit={(v) => mutate((c) => void (c.config.conventionRates[index]!.price = parseAmount(v)))}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="lnk tight"
                  title="Retirer cette ligne"
                  onClick={() => mutate((c) => void c.config.conventionRates.splice(index, 1))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="lnk"
        onClick={() =>
          mutate((c) => void c.config.conventionRates.push({ name: 'Nouveau', weekday: 1, label: '', price: 0 }))
        }
      >
        + Ajouter un jeune / un jour
      </button>

      <label>
        Trajets de la semaine — jeunes séparés par des virgules, précision entre parenthèses (ex. « Prénom Nom (matin)
        »). Les changements valent pour les courses créées ensuite.
      </label>
      <div className="scroll-x">
        <table className="plan">
          <thead>
            <tr>
              {['Jour', 'Début', 'Fin', 'Chauffeur', 'Trajet', 'Jeunes', ''].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => {
              const update = (mutator: (t: Circuit['config']['trips'][number]) => void) =>
                mutate((c) => {
                  const t = c.config.trips.find((x) => x.id === trip.id);
                  if (t) mutator(t);
                });
              return (
                <tr key={trip.id}>
                  <td>
                    <select
                      value={trip.weekday}
                      onChange={(e) => update((t) => void (t.weekday = Number(e.target.value)))}
                    >
                      {WORK_WEEKDAYS.map((w) => (
                        <option key={w} value={w}>
                          {dayName(w).slice(0, 3)}.
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <CommitInput
                      type="time"
                      value={toTimeInput(trip.start)}
                      onCommit={(v) => update((t) => void (t.start = fromTimeInput(v)))}
                    />
                  </td>
                  <td>
                    <CommitInput
                      type="time"
                      value={toTimeInput(trip.end)}
                      onCommit={(v) => update((t) => void (t.end = fromTimeInput(v)))}
                    />
                  </td>
                  <td>
                    <select
                      value={trip.driverId ?? ''}
                      onChange={(e) => update((t) => void (t.driverId = e.target.value || null))}
                    >
                      <option value="">—</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <CommitInput
                      className="wide"
                      value={trip.title}
                      onCommit={(v) => {
                        if (v.trim()) update((t) => void (t.title = v.trim()));
                      }}
                    />
                  </td>
                  <td>
                    <CommitInput
                      className="wide"
                      value={formatTripRiders(trip.riders)}
                      onCommit={(v) => update((t) => void (t.riders = parseTripRiders(v)))}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="lnk tight"
                      title="Retirer ce trajet"
                      onClick={() =>
                        mutate((c) => void (c.config.trips = c.config.trips.filter((t) => t.id !== trip.id)))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="lnk"
        onClick={() =>
          mutate(
            (c) =>
              void c.config.trips.push({
                id: crypto.randomUUID(),
                weekday: 1,
                start: 540,
                end: 570,
                driverId: null,
                title: 'Nouveau trajet',
                riders: [],
              }),
          )
        }
      >
        + Ajouter un trajet
      </button>
    </>
  );
}

function CircuitForm({ circuit, onDeleted }: { circuit: Circuit; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const { confirm, alert, run } = useDialogs();
  const { data: drivers } = useDrivers();
  const { data: settings } = useSettings();
  const { config } = circuit;

  /** Chaque modification est enregistrée aussitôt ; le serveur répercute horaires et tarifs sur les courses à venir. */
  const mutate: Mutate = (mutator) => {
    const next = structuredClone(circuit);
    mutator(next);
    queryClient.setQueryData<Circuit[]>(['circuits'], (old) => old?.map((c) => (c.id === next.id ? next : c)));
    const { id, ...body } = next;
    api
      .put(`/api/circuits/${id}`, body)
      .then(() => queryClient.invalidateQueries({ queryKey: ['events'] }))
      .catch(async (err: Error) => {
        await queryClient.invalidateQueries({ queryKey: ['circuits'] });
        await alert(err.message);
      });
  };

  const remove = async () => {
    const { events } = await api.get<{ events: number }>(`/api/circuits/${circuit.id}/impact`);
    const ok = await confirm(
      `Supprimer le circuit « ${circuit.name} »${events ? ` et ses ${events} courses dans l'agenda` : ''} ?`,
      { danger: true },
    );
    if (ok && (await run(() => api.delete(`/api/circuits/${circuit.id}`)))) onDeleted();
  };

  return (
    <>
      <div className="row">
        <div>
          <label>Nom</label>
          <CommitInput
            value={circuit.name}
            onCommit={(v) => {
              if (v.trim()) mutate((c) => void (c.name = v.trim()));
            }}
          />
        </div>
        <div>
          <label>Établissement facturé</label>
          <select
            value={circuit.establishmentId}
            onChange={(e) => mutate((c) => void (c.establishmentId = e.target.value))}
          >
            {(settings?.establishments ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Chauffeur</label>
          <select
            value={circuit.driverId ?? ''}
            onChange={(e) => mutate((c) => void (c.driverId = e.target.value || null))}
          >
            <option value="">— à choisir —</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        {circuitPeriods(config).map((period) => {
          const [from, to] = config.hours[period]!;
          return (
            <div key={period}>
              <label>Horaire {PERIOD_LABELS[period]}</label>
              <CommitInput
                type="time"
                className="auto"
                value={toTimeInput(from)}
                onCommit={(v) => mutate((c) => void (c.config.hours[period]![0] = fromTimeInput(v)))}
              />{' '}
              à{' '}
              <CommitInput
                type="time"
                className="auto"
                value={toTimeInput(to)}
                onCommit={(v) => mutate((c) => void (c.config.hours[period]![1] = fromTimeInput(v)))}
              />
            </div>
          );
        })}
      </div>
      {circuit.mode === 'per_run' ? (
        <>
          <label>Étapes à ne pas compter comme jeunes (séparées par des virgules)</label>
          <CommitInput
            value={config.stops.join(', ')}
            onCommit={(v) =>
              mutate(
                (c) =>
                  void (c.config.stops = v
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean)),
              )
            }
          />
          <label>
            Forfait par trajet en € TTC, quel que soit le nombre d'enfants (0 € s'il n'y en a aucun) — laisser vide pour
            un tarif selon les enfants présents
          </label>
          <CommitInput
            className="num"
            value={config.flatRate != null ? formatAmountInput(config.flatRate) : ''}
            onCommit={(v) =>
              mutate((c) => {
                if (!v.trim()) {
                  delete c.config.flatRate;
                  return;
                }
                const flat = parseAmount(v);
                c.config.flatRate = flat;
                for (const slot of Object.values(c.config.plan)) {
                  slot.price = flat;
                  slot.surcharge = 0;
                }
              })
            }
          />
          <label>Consignes pour le chauffeur (affichées au clic sur la course)</label>
          <CommitTextarea
            value={config.notes ?? ''}
            onCommit={(v) => mutate((c) => void (c.config.notes = v.trim()))}
          />
          <label>
            Planning type — jeunes séparés par « - », montant TTC de la course, supplément Tps UEE / DAP, horaire du
            jour s'il diffère de celui du circuit (ex. 13:05-14:15)
          </label>
          <PerRunPlan circuit={circuit} mutate={mutate} />
        </>
      ) : (
        <PerRiderTables circuit={circuit} mutate={mutate} />
      )}
      <div className="btns">
        <button type="button" onClick={() => void remove()}>
          Supprimer ce circuit
        </button>
      </div>
    </>
  );
}

function GenerateSection({ circuits }: { circuits: Circuit[] }) {
  const { confirm, run } = useDialogs();
  const now = new Date();
  const [from, setFrom] = useState(toIso(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  const [to, setTo] = useState(toIso(new Date(now.getFullYear(), now.getMonth() + 2, 0)));
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');

  const selected = circuits.filter((c) => !excluded.has(c.id)).map((c) => c.id);

  const generate = async () => {
    if (!selected.length) return setMessage('Cochez au moins un circuit.');
    await run(async () => {
      const res = await api.post<{ created: number; skipped: number }>('/api/circuits/generate', {
        from,
        to,
        circuitIds: selected,
      });
      setMessage(
        `${res.created} courses créées${res.skipped ? ` (${res.skipped} existaient déjà)` : ''}. Week-ends et jours fériés exclus : pour les vacances, supprimez la période avec le bouton à droite.`,
      );
    });
  };

  const removeRuns = async () => {
    if (!selected.length) return setMessage('Cochez au moins un circuit.');
    const body = { from, to, circuitIds: selected };
    await run(async () => {
      const { count } = await api.post<{ count: number }>('/api/circuits/delete-runs', { ...body, dryRun: true });
      if (!count) {
        setMessage('Aucune course de ces circuits sur cette période.');
        return;
      }
      const format = (s: string) => fromIso(s).toLocaleDateString('fr-FR');
      const ok = await confirm(`Supprimer ${count} courses des circuits cochés du ${format(from)} au ${format(to)} ?`, {
        danger: true,
      });
      if (!ok) return;
      const res = await api.post<{ count: number }>('/api/circuits/delete-runs', body);
      setMessage(`${res.count} courses supprimées.`);
    });
  };

  return (
    <div className="gen">
      <b>Créer les courses dans l'agenda</b> du{' '}
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> au{' '}
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      <div className="gen-circuits">
        {circuits.map((c) => (
          <label key={c.id} className="chk">
            <input
              type="checkbox"
              checked={!excluded.has(c.id)}
              onChange={(e) => {
                const next = new Set(excluded);
                if (e.target.checked) next.delete(c.id);
                else next.add(c.id);
                setExcluded(next);
              }}
            />
            {c.name}
            {c.driverId || c.config.trips.length ? '' : ' (⚠ sans chauffeur)'}
          </label>
        ))}
      </div>
      <div className="btns left">
        <button type="button" className="p" onClick={() => void generate()}>
          Créer les courses
        </button>
        <button type="button" onClick={() => void removeRuns()}>
          Supprimer les courses de la période
        </button>
      </div>
      <div className="gen-msg">{message}</div>
    </div>
  );
}

function NewCircuitDialog(props: { onClose: () => void; onCreated: (id: string) => void; colorIndex: number }) {
  const { run } = useDialogs();
  const { data: settings } = useSettings();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<Circuit['mode']>('per_run');

  const create = async () => {
    const establishment = settings?.establishments?.[0];
    if (!establishment) return;
    const perRider = mode === 'per_rider';
    const body: CircuitInput = {
      name: name.trim(),
      establishmentId: establishment.id,
      mode,
      driverId: null,
      color: DEFAULT_COURSE_COLORS[props.colorIndex % DEFAULT_COURSE_COLORS.length]!,
      config: {
        ...emptyCircuitConfig(),
        hours: perRider ? { jour: [720, 780] } : { matin: [450, 540], soir: [960, 1050] },
      },
    };
    await run(async () => {
      const created = await api.post<Circuit>('/api/circuits', body);
      props.onCreated(created.id);
    });
  };

  const hasEstablishment = !!settings?.establishments?.length;
  return (
    <Modal title="Nouveau circuit" width={460} onClose={props.onClose} onSubmit={() => void create()}>
      <label>Nom du circuit</label>
      <input type="text" required data-autofocus value={name} onChange={(e) => setName(e.target.value)} />
      <label>Facturation</label>
      <label className="chk">
        <input type="radio" checked={mode === 'per_run'} onChange={() => setMode('per_run')} /> Par course, matin et
        soir
      </label>
      <label className="chk">
        <input type="radio" checked={mode === 'per_rider'} onChange={() => setMode('per_rider')} /> Par jeune et par
        jour
      </label>
      {!hasEstablishment && <div className="err">Ajoutez d'abord un établissement dans la fenêtre Facturation.</div>}
      <div className="btns">
        <button type="button" onClick={props.onClose}>
          Annuler
        </button>
        <button className="p" disabled={!hasEstablishment || !name.trim()}>
          Créer
        </button>
      </div>
    </Modal>
  );
}

export function CircuitsDialog({ onClose }: { onClose: () => void }) {
  const circuits = useFullCircuits();
  const { data: drivers } = useDrivers();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const current = circuits.find((c) => c.id === currentId) ?? circuits[0] ?? null;

  useEffect(() => {
    if (current && current.id !== currentId) setCurrentId(current.id);
  }, [current, currentId]);

  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.name;

  return (
    <Modal title="Circuits et transports réguliers" width={1040} onClose={onClose}>
      <div className="row">
        <div className="circuit-side">
          <div className="circuit-list">
            {circuits.map((c) => (
              <button
                key={c.id}
                type="button"
                className={c.id === current?.id ? 'on' : undefined}
                style={{ borderLeftColor: c.color }}
                onClick={() => setCurrentId(c.id)}
              >
                {c.name}
                <small>
                  {c.config.trips.length
                    ? `${c.config.trips.length} trajets par semaine`
                    : (driverName(c.driverId) ?? '⚠ chauffeur à choisir')}
                </small>
              </button>
            ))}
          </div>
          <button type="button" className="lnk" onClick={() => setCreating(true)}>
            + Nouveau circuit
          </button>
        </div>
        <div className="grow-main">
          {current ? (
            <CircuitForm key={current.id} circuit={current} onDeleted={() => setCurrentId(null)} />
          ) : (
            <p>Aucun circuit.</p>
          )}
        </div>
      </div>
      <GenerateSection circuits={circuits} />
      <div className="btns">
        <button type="button" className="p" onClick={onClose}>
          Fermer
        </button>
      </div>
      {creating && (
        <NewCircuitDialog
          colorIndex={circuits.length}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCurrentId(id);
            setCreating(false);
          }}
        />
      )}
    </Modal>
  );
}
