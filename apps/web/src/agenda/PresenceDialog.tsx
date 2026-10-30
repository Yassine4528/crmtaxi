import {
  capitalize,
  conventionPrice,
  formatAmountInput,
  formatEuros,
  fromIso,
  longDate,
  normalize,
  parseAmount,
  presentRiders,
  rateFor,
  round2,
  WEEKDAYS,
  type AgendaEvent,
  type Rider,
} from '@taxi-crm/domain';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import type { CircuitIndex } from '../api/hooks.ts';
import { useDialogs } from '../components/Dialogs.tsx';
import { Modal } from '../components/Modal.tsx';
import { useSession } from '../session.tsx';

interface PresenceDialogProps {
  event: AgendaEvent;
  circuits: CircuitIndex;
  onClose: () => void;
}

export function PresenceDialog({ event, circuits, onClose }: PresenceDialogProps) {
  const { isAdmin } = useSession();
  const { run } = useDialogs();
  const info = event.circuitId ? circuits.get(event.circuitId) : undefined;
  const circuit = info?.full;
  const perRun = info?.mode === 'per_run';
  const period = event.run!.period;
  const date = fromIso(event.date);

  const [riders, setRiders] = useState<Rider[]>(event.run!.riders.map((r) => ({ ...r })));
  const [price, setPrice] = useState(formatAmountInput(event.run!.price));
  const [surcharge, setSurcharge] = useState(formatAmountInput(event.run!.surcharge));
  const [manual, setManual] = useState(false);
  const [newName, setNewName] = useState('');

  const presentNames = presentRiders({ ...event.run!, riders }).map((r) => r.name);
  const rate = circuit && perRun ? rateFor(circuit, period, presentNames) : null;

  // tant que le gérant n'a pas saisi de montant, il suit le tarif connu pour les présents
  useEffect(() => {
    if (!isAdmin || !perRun || manual) return;
    if (rate) {
      setPrice(formatAmountInput(rate.price));
      setSurcharge(formatAmountInput(rate.surcharge));
    } else if (!presentNames.length) {
      setPrice('0');
      setSurcharge('0');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rate` et `presentNames` dérivent de `riders`
  }, [riders, isAdmin, perRun, manual]);

  const update = (index: number, patch: Partial<Rider>) =>
    setRiders(riders.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (!riders.some((r) => normalize(r.name) === normalize(name))) {
      const known = circuit?.config.conventionRates.find((r) => normalize(r.name) === normalize(name));
      const conv = circuit ? conventionPrice(circuit, name, date.getDay(), '') : 0;
      setRiders([
        ...riders,
        {
          name: capitalize(name),
          label: '',
          absent: false,
          ...(isAdmin && !perRun ? { price: conv || known?.price || 0 } : {}),
        },
      ]);
    }
    setNewName('');
  };

  let info_ = '';
  if (isAdmin) {
    if (!perRun) {
      const total = round2(riders.filter((r) => !r.absent).reduce((sum, r) => sum + (r.price ?? 0), 0));
      info_ = `Tarif du jour des jeunes présents : ${formatEuros(total)} (compté une seule fois par jour, aller et retour compris).`;
    } else if (circuit?.config.flatRate != null) {
      info_ = `Forfait : ${formatEuros(circuit.config.flatRate)} par trajet (0 € s'il n'y a aucun enfant).`;
    } else if (rate) {
      info_ = 'Tarif déjà facturé pour cette combinaison de jeunes.';
    } else if (presentNames.length) {
      info_ = "⚠ Combinaison jamais facturée : vérifiez le montant avant d'enregistrer.";
    } else {
      info_ = 'Pas de transport.';
    }
  }

  const save = async () => {
    const ok = await run(() =>
      api.put(`/api/events/${event.id}/presence`, {
        riders,
        ...(isAdmin && perRun
          ? { price: parseAmount(price), surcharge: parseAmount(surcharge), manualPrice: manual }
          : {}),
      }),
    );
    if (ok) onClose();
  };

  return (
    <Modal
      title={`${event.title} — ${WEEKDAYS[date.getDay()]} ${longDate(date)}`}
      width={440}
      onClose={onClose}
      onSubmit={() => void save()}
    >
      <div className="presence">
        {riders.map((rider, i) => (
          <label key={`${rider.name}|${rider.label ?? ''}`} className={rider.absent ? 'abs' : undefined}>
            <input type="checkbox" checked={!rider.absent} onChange={(e) => update(i, { absent: !e.target.checked })} />
            <span>
              {rider.name}
              {rider.label ? ` (${rider.label})` : ''}
            </span>
            <small>{rider.absent ? 'absent' : 'présent'}</small>
            {isAdmin && !perRun && (
              <input
                className="pp"
                title="Prix TTC"
                defaultValue={formatAmountInput(rider.price)}
                onBlur={(e) => update(i, { price: parseAmount(e.target.value) })}
              />
            )}
          </label>
        ))}
      </div>
      <div className="row add-rider">
        <div className="grow3">
          <input
            type="text"
            placeholder="Ajouter un jeune (remplaçant…)"
            autoComplete="off"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <div>
          <button type="button" className="sm" onClick={add}>
            Ajouter
          </button>
        </div>
      </div>
      {isAdmin && perRun && (
        <div className="row">
          <div>
            <label>Montant de la course (TTC)</label>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setManual(true);
                setPrice(e.target.value);
              }}
            />
          </div>
          <div>
            <label>Tps UEE en + ou DAP</label>
            <input
              type="text"
              inputMode="decimal"
              value={surcharge}
              onChange={(e) => {
                setManual(true);
                setSurcharge(e.target.value);
              }}
            />
          </div>
        </div>
      )}
      <div className="info">{info_}</div>
      <div className="btns">
        <button type="button" onClick={onClose}>
          Annuler
        </button>
        <button className="p">Enregistrer</button>
      </div>
    </Modal>
  );
}
