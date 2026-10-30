import { formatTime, STATUS_LABELS, toIso } from '@taxi-crm/domain';
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { CircuitIndex } from '../api/hooks.ts';
import { isGroup, itemText, layoutOverlaps, type GridItem } from './display.ts';

export const HOUR_START = 4;
export const HOUR_END = 22;
export const HOUR_HEIGHT = 40;
const MIN_START = HOUR_START * 60;
const MIN_END = HOUR_END * 60;
const STEP = 15;

const toY = (minutes: number) => ((minutes - MIN_START) / 60) * HOUR_HEIGHT;

export interface GridColumn {
  key: string;
  label: string;
  date: string;
  driverIds: string[];
  isToday: boolean;
}

interface GridProps {
  columns: GridColumn[];
  itemsFor: (column: GridColumn) => GridItem[];
  circuits: CircuitIndex;
  isAdmin: boolean;
  canAdd: boolean;
  driverName: (id: string) => string;
  highlightId: string | null;
  onCreate: (column: GridColumn, start: number, end: number) => void;
  onOpen: (item: GridItem, event: ReactMouseEvent) => void;
  onMove: (item: GridItem, column: GridColumn, shift: number) => void;
}

interface Ghost {
  columnKey: string;
  top: number;
  height: number;
  label: string;
}

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function Grid(props: GridProps) {
  const { columns, itemsFor, circuits, isAdmin, canAdd, driverName, highlightId, onCreate, onOpen, onMove } = props;
  const now = useNow();
  const todayIso = toIso(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const justDragged = useRef(false);

  /** Clic simple = rendez-vous d'une heure ; clic maintenu + glisser = durée choisie à la souris. */
  const startCreate = (e: ReactMouseEvent<HTMLDivElement>, column: GridColumn) => {
    if (e.target !== e.currentTarget || e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const top = () => el.getBoundingClientRect().top;
    const origin = MIN_START + Math.floor(((e.clientY - top()) / HOUR_HEIGHT) * 4) * STEP;
    let a = origin;
    let b = origin + STEP;
    const draw = (y: number) => {
      const m = Math.max(MIN_START, Math.min(MIN_END, MIN_START + Math.round(((y - top()) / HOUR_HEIGHT) * 4) * STEP));
      a = Math.min(origin, m);
      b = Math.max(origin + STEP, m);
      setGhost({
        columnKey: column.key,
        top: toY(a),
        height: ((b - a) / 60) * HOUR_HEIGHT,
        label: `${formatTime(a)}-${formatTime(b)}`,
      });
    };
    const move = (m: MouseEvent) => draw(m.clientY);
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setGhost(null);
      if (b - a <= STEP) b = Math.min(a + 60, MIN_END);
      onCreate(column, a, b);
    };
    draw(e.clientY);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  /** Gérant : glisser une course vers un autre chauffeur, un autre jour ou une autre heure. */
  const startMove = (e: ReactMouseEvent<HTMLDivElement>, item: GridItem) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const height = e.currentTarget.offsetHeight;
    let started = false;
    let target: GridColumn | null = null;
    let shift = 0;
    const move = (m: MouseEvent) => {
      const dy = m.clientY - y0;
      if (!started) {
        if (Math.abs(m.clientX - x0) < 6 && Math.abs(dy) < 6) return;
        started = true;
        setDraggingId(item.id);
      }
      const under = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>('.col');
      const found = under && columns.find((c) => c.key === under.dataset.column);
      if (found) target = found;
      // l'heure ne change que si on déplace nettement vers le haut ou le bas
      shift = Math.abs(dy) >= STEP ? Math.round((dy / HOUR_HEIGHT) * 4) * STEP : 0;
      shift = Math.max(MIN_START - item.start, Math.min(MIN_END - item.end, shift));
      if (target) {
        setGhost({
          columnKey: target.key,
          top: toY(item.start + shift),
          height,
          label: `${target.label} ${formatTime(item.start + shift)}-${formatTime(item.end + shift)}`,
        });
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setGhost(null);
      setDraggingId(null);
      if (!started) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      if (target) onMove(item, target, shift);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const hours: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);

  if (!columns.length) {
    return (
      <div id="grid">
        <div id="hours">
          {hours.map((h) => (
            <div key={h}>{h}h</div>
          ))}
        </div>
        <div className="grid-empty">Aucun agenda sélectionné.</div>
      </div>
    );
  }

  return (
    <div id="grid">
      <div id="hours">
        {hours.map((h) => (
          <div key={h}>{h}h</div>
        ))}
      </div>
      {columns.map((column) => {
        const { sorted, positions } = layoutOverlaps(itemsFor(column));
        return (
          <div
            key={column.key}
            data-column={column.key}
            className={`col${canAdd ? ' edit' : ''}`}
            style={{ height: (HOUR_END - HOUR_START) * HOUR_HEIGHT }}
            onMouseDown={canAdd ? (e) => startCreate(e, column) : undefined}
          >
            {sorted.map((item) => {
              const start = Math.max(item.start, MIN_START);
              const end = Math.min(item.end, MIN_END);
              if (end <= start) return null;
              const pos = positions.get(item.id)!;
              const who = column.driverIds.length > 1 ? `[${driverName(item.driverId)}] ` : '';
              const highlighted =
                item.id === highlightId || (isGroup(item) && item.group.some((x) => x.id === highlightId));
              const prefix = item.status ? `${STATUS_LABELS[item.status]} · ` : '';
              return (
                <div
                  key={item.id}
                  className={`ev${highlighted ? ' hl' : ''}${item.status ? ' st' : ''}`}
                  title={`${formatTime(item.start)}-${formatTime(item.end)}  ${who}${item.title}`}
                  style={{
                    top: toY(start),
                    height: Math.max(((end - start) / 60) * HOUR_HEIGHT, 12),
                    left: `${(pos.lane / pos.lanes) * 96}%`,
                    width: `${96 / pos.lanes}%`,
                    opacity: draggingId === item.id ? 0.35 : undefined,
                    background: item.status ? undefined : item.color,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!justDragged.current) onOpen(item, e);
                  }}
                  onMouseDown={isAdmin ? (e) => startMove(e, item) : undefined}
                >
                  {prefix}
                  {item.seriesId ? '↻ ' : ''}
                  {who}
                  {itemText(item, isAdmin, circuits)}
                </div>
              );
            })}
            {ghost?.columnKey === column.key && (
              <div className="ghost" style={{ top: ghost.top, height: ghost.height }}>
                {ghost.label}
              </div>
            )}
            {column.date === todayIso && nowMinutes >= MIN_START && nowMinutes < MIN_END && (
              <div className="now" style={{ top: toY(nowMinutes) }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
