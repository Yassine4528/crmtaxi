import { adminPasswordSchema, daysBetween, fromIso, toIso, type AgendaEvent, type Driver } from '@taxi-crm/domain';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { useDrivers, useFlagged, useSettings } from '../api/hooks.ts';
import { useDialogs } from '../components/Dialogs.tsx';
import { Modal } from '../components/Modal.tsx';
import { useSession } from '../session.tsx';
import { MiniCalendar } from './MiniCalendar.tsx';
import { storage } from './storage.ts';

const BACKUP_KEY = 'taxi-crm:last-backup';

interface SidebarProps {
  month: Date;
  day: Date;
  weekView: boolean;
  onMonth: (month: Date) => void;
  onSelect: (day: Date) => void;
  hiddenDrivers: Set<string>;
  setHiddenDrivers: (next: Set<string>) => void;
  highlightId: string | null;
  onShowEvent: (event: AgendaEvent) => void;
}

function AccessDialog({ driver, onClose }: { driver: Driver; onClose: () => void }) {
  const { run } = useDialogs();
  const [code, setCode] = useState('');
  const [removeCode, setRemoveCode] = useState(false);
  const [canAdd, setCanAdd] = useState(driver.canAdd);
  const [canDelete, setCanDelete] = useState(driver.canDelete);

  const save = async () => {
    const ok = await run(() =>
      api.patch(`/api/drivers/${driver.id}`, {
        canAdd,
        canDelete,
        ...(removeCode ? { code: null } : code.trim() ? { code: code.trim() } : {}),
      }),
    );
    if (ok) onClose();
  };

  return (
    <Modal title={`Accès de ${driver.name}`} width={380} onClose={onClose} onSubmit={() => void save()}>
      <label>{driver.hasCode ? "Nouveau code d'accès (vide = inchangé)" : "Code d'accès (6 caractères minimum)"}</label>
      <input
        type="password"
        data-autofocus
        autoComplete="new-password"
        value={code}
        disabled={removeCode}
        onChange={(e) => setCode(e.target.value)}
      />
      {driver.hasCode && (
        <label className="chk">
          <input type="checkbox" checked={removeCode} onChange={(e) => setRemoveCode(e.target.checked)} /> Retirer le
          code (le chauffeur ne pourra plus se connecter)
        </label>
      )}
      <label className="chk">
        <input type="checkbox" checked={canAdd} onChange={(e) => setCanAdd(e.target.checked)} /> Peut ajouter des
        rendez-vous
      </label>
      <label className="chk">
        <input type="checkbox" checked={canDelete} onChange={(e) => setCanDelete(e.target.checked)} /> Peut supprimer
        des rendez-vous
      </label>
      <p className="hint">
        Dans tous les cas, le chauffeur peut marquer un rendez-vous « annulé » ou « absent » : vous décidez ensuite de
        le supprimer ou de le rétablir.
      </p>
      <div className="btns">
        <button type="button" onClick={onClose}>
          Annuler
        </button>
        <button className="p">Enregistrer</button>
      </div>
    </Modal>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { run } = useDialogs();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    const check = adminPasswordSchema.safeParse(next);
    if (!check.success) {
      setError(check.error.issues[0]?.message ?? 'Mot de passe invalide.');
      return;
    }
    if (await run(() => api.post('/api/auth/password', { current, next }))) onClose();
  };

  return (
    <Modal title="Changer mon mot de passe" width={380} onClose={onClose} onSubmit={() => void save()}>
      <label>Mot de passe actuel</label>
      <input
        type="password"
        data-autofocus
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <label>Nouveau mot de passe (12 caractères minimum)</label>
      <input
        type="password"
        autoComplete="new-password"
        required
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <div className="err">{error}</div>
      <div className="btns">
        <button type="button" onClick={onClose}>
          Annuler
        </button>
        <button className="p">Enregistrer</button>
      </div>
    </Modal>
  );
}

function BackupSection() {
  const { confirm, alert, run } = useDialogs();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [lastBackup, setLastBackup] = useState(() => storage.get(BACKUP_KEY));

  const days = lastBackup ? daysBetween(fromIso(lastBackup), fromIso(toIso(new Date()))) : null;
  const info = lastBackup
    ? `Dernière sauvegarde : ${days === 0 ? "aujourd'hui" : `il y a ${days} jour${days! > 1 ? 's' : ''}`}`
    : 'Aucune sauvegarde depuis ce navigateur';

  const exportData = async () => {
    await run(async () => {
      const data = await api.get<unknown>('/api/backup');
      const today = toIso(new Date());
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      link.download = `taxi-crm-sauvegarde-${today}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      storage.set(BACKUP_KEY, today);
      setLastBackup(today);
    });
  };

  const importData = async (file: File | undefined) => {
    if (!file) return;
    let parsed: { events?: unknown[]; clients?: unknown[] };
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      await alert("Ce fichier n'est pas une sauvegarde de l'agenda.");
      return;
    }
    const ok = await confirm(
      `Remplacer toutes les données actuelles par cette sauvegarde (${parsed.events?.length ?? 0} rendez-vous, ${parsed.clients?.length ?? 0} fiches clients) ?\n\nCe qui a été saisi depuis cette sauvegarde sera perdu.`,
      { danger: true },
    );
    if (!ok) return;
    if (await run(() => api.post('/api/backup/restore', parsed))) await queryClient.resetQueries();
  };

  return (
    <>
      <button className="lnk" onClick={() => void exportData()}>
        Sauvegarder mes données
      </button>
      <button className="lnk" onClick={() => fileInput.current?.click()}>
        Restaurer une sauvegarde
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hide"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void importData(file);
        }}
      />
      <div className={`bk${days === null || days > 7 ? ' warn' : ''}`}>{info}</div>
    </>
  );
}

export function Sidebar(props: SidebarProps) {
  const { month, day, weekView, onMonth, onSelect, hiddenDrivers, setHiddenDrivers, highlightId, onShowEvent } = props;
  const { isAdmin, user } = useSession();
  const { data: drivers } = useDrivers();
  const { data: settings } = useSettings();
  const { data: flagged = [] } = useFlagged();
  const { prompt, confirm, run } = useDialogs();
  const [accessOf, setAccessOf] = useState<Driver | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const toggle = (id: string, on: boolean) => {
    const next = new Set(hiddenDrivers);
    if (on) next.delete(id);
    else next.add(id);
    setHiddenDrivers(next);
  };

  const rename = async (driver: Driver) => {
    const name = await prompt('Nom du chauffeur :', driver.name);
    if (name?.trim()) await run(() => api.patch(`/api/drivers/${driver.id}`, { name: name.trim() }));
  };

  const remove = async (driver: Driver) => {
    const { events } = await api.get<{ events: number }>(`/api/drivers/${driver.id}/impact`);
    const ok = await confirm(`Supprimer « ${driver.name} »${events ? ` et ses ${events} rendez-vous` : ''} ?`, {
      danger: true,
    });
    if (ok) await run(() => api.delete(`/api/drivers/${driver.id}`));
  };

  const addDriver = async () => {
    const name = await prompt('Nom du nouveau chauffeur :');
    if (name?.trim()) await run(() => api.post('/api/drivers', { name: name.trim() }));
  };

  const renameCompany = async () => {
    if (!isAdmin || !settings) return;
    const name = await prompt("Nom de l'entreprise :", settings.companyName);
    if (name?.trim()) await run(() => api.put('/api/settings', { ...settings, companyName: name.trim() }));
  };

  const nextFlag = () => {
    const i = flagged.findIndex((e) => e.id === highlightId);
    const event = flagged[(i + 1) % flagged.length];
    if (event) onShowEvent(event);
  };

  return (
    <aside id="side">
      {isAdmin ? (
        <button id="biz" className="clickable" title="Cliquer pour renommer" onClick={() => void renameCompany()}>
          {settings?.companyName}
        </button>
      ) : (
        <div id="biz">{settings?.companyName}</div>
      )}
      <MiniCalendar month={month} selected={day} weekView={weekView} onMonth={onMonth} onSelect={onSelect} />
      {isAdmin && flagged.length > 0 && (
        <button className="lnk flags" onClick={nextFlag}>
          ⚠ {flagged.length} RDV signalé{flagged.length > 1 ? 's' : ''} (annulé / absent)
        </button>
      )}
      <h3>{isAdmin ? 'MES AGENDAS' : 'MON AGENDA'}</h3>
      {!isAdmin ? (
        <div className="ag all">{user.name}</div>
      ) : (
        <>
          <label className="ag all">
            <input
              type="checkbox"
              checked={drivers.length > 0 && drivers.every((d) => !hiddenDrivers.has(d.id))}
              onChange={(e) => setHiddenDrivers(new Set(e.target.checked ? [] : drivers.map((d) => d.id)))}
            />
            <span>Tous</span>
          </label>
          {drivers.map((driver) => (
            <div key={driver.id} className="ag">
              <input
                type="checkbox"
                aria-label={`Afficher ${driver.name}`}
                checked={!hiddenDrivers.has(driver.id)}
                onChange={(e) => toggle(driver.id, e.target.checked)}
              />
              <button className="nm" title="Cliquer pour renommer" onClick={() => void rename(driver)}>
                {driver.name}
              </button>
              {!driver.hasCode && <span className="nopin">(sans code)</span>}
              <span className="act">
                <button
                  title="Code d'accès et droits de ce chauffeur"
                  aria-label={`Accès de ${driver.name}`}
                  onClick={() => setAccessOf(driver)}
                >
                  ⚙
                </button>
                <button
                  className="x"
                  title="Supprimer ce chauffeur"
                  aria-label={`Supprimer ${driver.name}`}
                  onClick={() => void remove(driver)}
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
          <button className="lnk" onClick={() => void addDriver()}>
            + Ajouter un chauffeur
          </button>
          <button className="lnk" onClick={() => setChangingPassword(true)}>
            Changer mon mot de passe
          </button>
          <BackupSection />
        </>
      )}
      {accessOf && <AccessDialog driver={accessOf} onClose={() => setAccessOf(null)} />}
      {changingPassword && <PasswordDialog onClose={() => setChangingPassword(false)} />}
    </aside>
  );
}
