import { addDays, fromIso, isoWeek, monday, MONTHS, toIso } from '@taxi-crm/domain';

interface MiniCalendarProps {
  month: Date;
  selected: Date;
  weekView: boolean;
  onMonth: (month: Date) => void;
  onSelect: (day: Date) => void;
}

const HEADERS = ['LU', 'MA', 'ME', 'JE', 'VE', 'SA', 'DI'];

export function MiniCalendar({ month, selected, weekView, onMonth, onSelect }: MiniCalendarProps) {
  const todayIso = toIso(new Date());
  const selectedIso = toIso(selected);
  const selectedMonday = toIso(monday(selected));
  const weeks: Date[] = [0, 1, 2, 3, 4, 5].map((w) => addDays(monday(month), w * 7));
  return (
    <>
      <div className="mhead">
        <button
          className="round"
          aria-label="Mois précédent"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          ◀
        </button>
        <span>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <button
          className="round"
          aria-label="Mois suivant"
          onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          ▶
        </button>
      </div>
      <table id="mini">
        <thead>
          <tr>
            <th />
            {HEADERS.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((start) => (
            <tr key={toIso(start)} className={weekView && toIso(start) === selectedMonday ? 'selw' : undefined}>
              <td className="wk">{isoWeek(start)}</td>
              {[0, 1, 2, 3, 4, 5, 6].map((i) => {
                const d = addDays(start, i);
                const key = toIso(d);
                const classes = [
                  d.getMonth() !== month.getMonth() && 'out',
                  key === todayIso && 'today',
                  key === selectedIso && 'sel',
                ].filter(Boolean);
                return (
                  <td key={key} className={classes.join(' ')} onClick={() => onSelect(fromIso(key))}>
                    <span>{d.getDate()}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
