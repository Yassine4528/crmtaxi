import {
  formatEuros,
  formatTime,
  runAmount,
  STATUS_LABELS,
  type AgendaEvent,
  type EventStatus,
} from '@taxi-crm/domain';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import type { CircuitIndex } from '../api/hooks.ts';
import { useDialogs } from '../components/Dialogs.tsx';
import { useSession } from '../session.tsx';
import { isGroup, itemText, type GridItem } from './display.ts';

interface EventPopoverProps {
  item: GridItem;
  anchor: { x: number; y: number };
  circuits: CircuitIndex;
  driverName: (id: string) => string;
  onClose: () => void;
  onEdit: (event: AgendaEvent) => void;
  onPresence: (event: AgendaEvent) => void;
}

function eventDetails(
  event: AgendaEvent,
  isAdmin: boolean,
  circuits: CircuitIndex,
  driverName: (id: string) => string,
) {
  const circuit = event.circuitId ? circuits.get(event.circuitId) : undefined;
  const lines = [itemText(event, isAdmin, circuits)];
  if (event.run && isAdmin && circuit?.mode === 'per_run')
    lines.push(`Montant : ${formatEuros(runAmount(event, 'per_run'))}`);
  if (isAdmin) lines.push(`— ${driverName(event.driverId)}`);
  if (circuit?.notes) lines.push(`📌 ${circuit.notes}`);
  if (event.client) {
    lines.push(`☎ ${event.client.tel || 'pas de téléphone'}`);
    if (event.client.address) lines.push(event.client.address);
  }
  if (event.status) {
    lines.push(`⚠ ${STATUS_LABELS[event.status]}${event.statusBy ? ` — signalé par ${event.statusBy}` : ''}`);
  }
  if (event.seriesId) lines.push('↻ Rendez-vous récurrent');
  return lines.join('\n');
}

export function EventPopover(props: EventPopoverProps) {
  const { item, anchor, circuits, driverName, onClose, onEdit, onPresence } = props;
  const { isAdmin, user } = useSession();
  const { confirm, run } = useDialogs();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setPosition({
      left: Math.max(8, Math.min(anchor.x - 200, window.innerWidth - 200)),
      top: Math.max(8, Math.min(anchor.y - 20, window.innerHeight - height - 8)),
    });
  }, [anchor]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!ref.current?.contains(target) && !target.closest?.('dialog') && !target.classList?.contains('ev')) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const style = { left: position.left, top: position.top };
  const canPresence = (e: AgendaEvent) => isAdmin || e.driverId === user.id;

  if (isGroup(item)) {
    const text =
      item.title +
      item.group
        .map((e) => {
          const notes = e.circuitId && circuits.get(e.circuitId)?.notes;
          return `\n— ${itemText(e, isAdmin, circuits).replace(/\n/g, ' · ')}${notes ? `\n📌 ${notes}` : ''}`;
        })
        .join('') +
      (isAdmin ? `\n— ${driverName(item.driverId)}` : '');
    return (
      <div id="pop" ref={ref} style={style}>
        <div className="t">
          {formatTime(item.start)}-{formatTime(item.end)}
        </div>
        <div className="n">{text}</div>
        {item.group.filter(canPresence).map((e) => (
          <button key={e.id} type="button" className="p small" onClick={() => onPresence(e)}>
            PRÉSENCES {(e.circuitId && circuits.get(e.circuitId)?.name.toUpperCase()) || ''}
          </button>
        ))}
      </div>
    );
  }

  const event = item;
  const setStatus = async (status: EventStatus | null) => {
    if (await run(() => api.post(`/api/events/${event.id}/status`, { status }))) onClose();
  };
  const removeOne = async () => {
    if (await confirm(`Supprimer le rendez-vous « ${event.title} » ?`, { danger: true })) {
      if (await run(() => api.delete(`/api/events/${event.id}`))) onClose();
    }
  };
  const removeFollowing = async () => {
    const { count } = await api.get<{ count: number }>(`/api/events/${event.id}/following-count`);
    if (await confirm(`Supprimer ce rendez-vous et les suivants de la série (${count} au total) ?`, { danger: true })) {
      if (await run(() => api.delete(`/api/events/${event.id}?scope=following`))) onClose();
    }
  };

  return (
    <div id="pop" ref={ref} style={style}>
      <div className="t">
        {formatTime(event.start)}-{formatTime(event.end)}
      </div>
      <div className="n">{eventDetails(event, isAdmin, circuits, driverName)}</div>
      {event.run && canPresence(event) && (
        <button className="p" onClick={() => onPresence(event)}>
          PRÉSENCES / ABSENCES
        </button>
      )}
      {isAdmin && (
        <button className="p" onClick={() => onEdit(event)}>
          MODIFIER
        </button>
      )}
      {user.canDelete && <button onClick={() => void removeOne()}>SUPPRIMER</button>}
      {user.canDelete && event.seriesId && <button onClick={() => void removeFollowing()}>CELUI-CI ET SUIVANTS</button>}
      {!event.status && <button onClick={() => void setStatus('annule')}>MARQUER ANNULÉ</button>}
      {!event.status && <button onClick={() => void setStatus('absent')}>MARQUER ABSENT</button>}
      {event.status && <button onClick={() => void setStatus(null)}>RÉTABLIR LE RDV</button>}
    </div>
  );
}
