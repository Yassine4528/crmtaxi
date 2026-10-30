import {
  capitalize,
  formatEuros,
  MONTHS,
  toIso,
  WEEKDAYS,
  type BillingRow,
  type Memo,
  type Settings,
} from '@taxi-crm/domain';
import { useState } from 'react';
import { api } from '../api/client.ts';
import { useBilling, useSettings } from '../api/hooks.ts';
import { CommitInput, CommitTextarea } from '../components/CommitInput.tsx';
import { useDialogs } from '../components/Dialogs.tsx';
import { Modal } from '../components/Modal.tsx';
import { usePrint } from '../print/PrintProvider.tsx';

function MemoSheet({ memo }: { memo: Memo }) {
  const [year, month] = memo.month.split('-').map(Number) as [number, number];
  return (
    <section className="mem">
      <div className="mt">
        TRANSPORT EN TAXI D’ENFANTS ET ADOLESCENTS FRÉQUENTANT UN ÉTABLISSEMENT D’ÉDUCATION SPÉCIALE
      </div>
      <div className="mh">
        <div>
          <b>Convention passée entre :</b>
          <div className="pre">{memo.establishmentAddress}</div>
        </div>
        <div>
          <b>Et :</b>
          <div className="pre">{memo.companyAddress}</div>
        </div>
      </div>
      <div className="mm">
        Facturation pour le mois de {MONTHS[month - 1]} {year} — {memo.circuitName}
      </div>
      {memo.mode === 'per_run' ? (
        <table>
          <thead>
            <tr>
              <th>Jours et date</th>
              <th />
              <th>Nombre de jeunes</th>
              <th>Noms des jeunes</th>
              <th className="n">Tps UEE en + ou DAP</th>
              <th className="n">Montant de la course</th>
            </tr>
          </thead>
          <tbody>
            {memo.runLines.map((line, i) => (
              <tr key={i}>
                <td>{line.date}</td>
                <td>{line.period}</td>
                <td>{line.riderCount}</td>
                <td>{line.riders}</td>
                <td className="n">{line.surcharge ? formatEuros(line.surcharge) : ''}</td>
                <td className="n">{formatEuros(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Jeune</th>
              <th>Jour</th>
              <th>Dates</th>
              <th className="n">P.U. HT</th>
              <th className="n">Qté</th>
              <th className="n">Total HT</th>
              <th className="n">Total TTC</th>
            </tr>
          </thead>
          <tbody>
            {memo.riderLines.map((line, i) => (
              <tr key={i}>
                <td>{line.name}</td>
                <td>
                  {capitalize(WEEKDAYS[line.weekday]!)}
                  {line.label ? ` ${line.label}` : ''}
                </td>
                <td>{line.dates.join(', ')}</td>
                <td className="n">{formatEuros(line.unitHt)}</td>
                <td className="n">{line.quantity}</td>
                <td className="n">{formatEuros(line.ht)}</td>
                <td className="n">{formatEuros(line.ttc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="mtot">
        <tbody>
          <tr>
            <td>TOTAL TTC</td>
            <td className="n">{formatEuros(memo.ttc)}</td>
          </tr>
          <tr>
            <td>TVA {memo.vatPercent} %</td>
            <td className="n">{formatEuros(memo.vat)}</td>
          </tr>
          <tr>
            <td>TOTAL HT</td>
            <td className="n">{formatEuros(memo.ht)}</td>
          </tr>
        </tbody>
      </table>
      <p>
        Certifié sincère et véritable le présent mémoire arrêté à la somme de : {memo.amountInWords} (
        {formatEuros(memo.ttc)} TTC).
      </p>
      <div className="msig">
        <span>Date : {new Date().toLocaleDateString('fr-FR')}</span>
        <span>Le Transporteur,</span>
      </div>
    </section>
  );
}

function SettingsSection({ settings }: { settings: Settings }) {
  const { run } = useDialogs();
  const save = (patch: Partial<Settings>) => void run(() => api.put('/api/settings', { ...settings, ...patch }));

  const updateEstablishment = (id: string, patch: { label?: string; address?: string }) =>
    save({ establishments: settings.establishments.map((e) => (e.id === id ? { ...e, ...patch } : e)) });

  return (
    <details className="settings">
      <summary>En-têtes des mémoires (coordonnées)</summary>
      <div className="row">
        <div>
          <label>Transporteur</label>
          <CommitTextarea value={settings.companyAddress} onCommit={(v) => save({ companyAddress: v.trim() })} />
        </div>
        <div className="narrow">
          <label>TVA (%)</label>
          <CommitInput
            className="num"
            value={String(settings.vatPercent)}
            onCommit={(v) => {
              const vat = Number(v.replace(',', '.'));
              if (!Number.isNaN(vat)) save({ vatPercent: vat });
            }}
          />
        </div>
      </div>
      {settings.establishments.map((e) => (
        <div key={e.id} className="row">
          <div>
            <label>Nom affiché</label>
            <CommitInput value={e.label} onCommit={(v) => updateEstablishment(e.id, { label: v.trim() })} />
          </div>
          <div>
            <label>Coordonnées</label>
            <CommitTextarea value={e.address} onCommit={(v) => updateEstablishment(e.id, { address: v.trim() })} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="lnk"
        onClick={() =>
          save({
            establishments: [
              ...settings.establishments,
              { id: crypto.randomUUID(), label: 'Nouvel établissement', address: '' },
            ],
          })
        }
      >
        + Ajouter un établissement
      </button>
    </details>
  );
}

function Row({ row, onPrint, onReview }: { row: BillingRow; onPrint: () => void; onReview: () => void }) {
  return (
    <tr>
      <td>{row.name}</td>
      <td>{row.runCount}</td>
      <td>
        {row.needsReview.count > 0 && (
          <button type="button" className="warn" title="Voir la première course à vérifier" onClick={onReview}>
            ⚠ {row.needsReview.count}
          </button>
        )}
      </td>
      <td className="n">{formatEuros(row.ttc)}</td>
      <td className="n">{formatEuros(row.ht)}</td>
      <td className="n">{formatEuros(row.vat)}</td>
      <td>
        {row.runCount > 0 && (
          <button type="button" className="sm auto" onClick={onPrint}>
            Imprimer
          </button>
        )}
      </td>
    </tr>
  );
}

interface BillingDialogProps {
  onClose: () => void;
  onShowEvent: (target: { id: string; date: string; driverId: string }) => void;
}

export function BillingDialog({ onClose, onShowEvent }: BillingDialogProps) {
  const [month, setMonth] = useState(toIso(new Date()).slice(0, 7));
  const { data: sections = [], isLoading } = useBilling(month);
  const { data: settings } = useSettings();
  const { alert, run } = useDialogs();
  const print = usePrint();

  const printMemos = async (circuitId?: string) => {
    await run(async () => {
      const memos = await api.get<Memo[]>(
        `/api/billing/${month}/memos${circuitId ? `?circuitId=${encodeURIComponent(circuitId)}` : ''}`,
      );
      if (!memos.length) {
        await alert('Aucune course sur ce mois.');
        return;
      }
      print(
        <>
          {memos.map((memo) => (
            <MemoSheet key={memo.circuitName} memo={memo} />
          ))}
        </>,
      );
    });
  };

  return (
    <Modal title="Facturation des circuits" width={860} onClose={onClose}>
      <label>Mois facturé</label>
      <input type="month" className="auto" value={month} onChange={(e) => setMonth(e.target.value)} />
      <div className="billing">
        {isLoading ? (
          <p>Chargement…</p>
        ) : (
          <table className="faT">
            <thead>
              <tr>
                <th>Circuit</th>
                <th>Courses</th>
                <th>À vérifier</th>
                <th className="n">Total TTC</th>
                <th className="n">HT</th>
                <th className="n">TVA</th>
                <th />
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.establishmentId}>
                <tr>
                  <td colSpan={7} className="sec">
                    {section.label}
                  </td>
                </tr>
                {section.rows.map((row) => (
                  <Row
                    key={row.circuitId}
                    row={row}
                    onPrint={() => void printMemos(row.circuitId)}
                    onReview={() => {
                      const { firstEventId, firstDate, firstDriverId } = row.needsReview;
                      if (firstEventId && firstDate && firstDriverId) {
                        onShowEvent({ id: firstEventId, date: firstDate, driverId: firstDriverId });
                      }
                    }}
                  />
                ))}
                <tr className="tot">
                  <td>Total {section.label}</td>
                  <td />
                  <td />
                  <td className="n">{formatEuros(section.ttc)}</td>
                  <td className="n">{formatEuros(section.ht)}</td>
                  <td className="n">{formatEuros(section.vat)}</td>
                  <td />
                </tr>
              </tbody>
            ))}
          </table>
        )}
      </div>
      {settings?.establishments && <SettingsSection settings={settings as Settings} />}
      <div className="btns">
        <button type="button" onClick={() => void printMemos()}>
          Imprimer tous les mémoires du mois
        </button>
        <button type="button" className="p" onClick={onClose}>
          Fermer
        </button>
      </div>
    </Modal>
  );
}
