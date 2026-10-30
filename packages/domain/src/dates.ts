/** Dates au format `YYYY-MM-DD` (heure locale) et horaires en minutes depuis minuit. */

export const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
export const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const DAY_MS = 864e5;

export const pad = (n: number): string => String(n).padStart(2, '0');

export const toIso = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromIso(s: string): Date {
  const [y = 0, m = 1, d = 1] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const monday = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7));

export const daysBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / DAY_MS);

/** 570 → « 09h30 » */
export const formatTime = (m: number): string => `${pad(Math.floor(m / 60))}h${pad(m % 60)}`;

/** 570 → « 09:30 », format des champs `<input type="time">` */
export const toTimeInput = (m: number): string => formatTime(m).replace('h', ':');

export function fromTimeInput(s: string): number {
  const [h = 0, m = 0] = s.split(':').map(Number);
  return h * 60 + m;
}

/** Numéro de semaine ISO 8601. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const n = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - n);
  return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
}

export const capitalize = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const weekdayName = (d: Date): string => WEEKDAYS[d.getDay()]!;
const monthName = (d: Date): string => MONTHS[d.getMonth()]!;

/** « 12 octobre » */
export const longDate = (d: Date): string => `${d.getDate()} ${monthName(d)}`;

/** « LUN 12/10 » */
export const shortDate = (d: Date): string =>
  `${weekdayName(d).slice(0, 3).toUpperCase()} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;

/** « Lundi 12 Octobre 2026 » */
export const fullDate = (d: Date): string =>
  `${capitalize(weekdayName(d))} ${d.getDate()} ${capitalize(monthName(d))} ${d.getFullYear()}`;

/** « lundi 12 octobre 2026 » */
export const memoDate = (d: Date): string => `${weekdayName(d)} ${d.getDate()} ${monthName(d)} ${d.getFullYear()}`;

/** Date de Pâques (algorithme de Meeus/Jones/Butcher). */
export function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

const FIXED_HOLIDAYS = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];
/** Lundi de Pâques, Ascension, lundi de Pentecôte (jours après Pâques). */
const EASTER_OFFSETS = [1, 39, 50];

/** Jour férié légal en France métropolitaine. */
export function isHoliday(d: Date): boolean {
  const key = toIso(d);
  const e = easter(d.getFullYear());
  return FIXED_HOLIDAYS.includes(key.slice(5)) || EASTER_OFFSETS.some((n) => toIso(addDays(e, n)) === key);
}

/** Dates d'une récurrence : jours cochés, une semaine sur `every`, de `from` à `until` inclus. */
export function recurrenceDates(from: Date, until: Date, every: number, weekdays: number[], max: number): string[] {
  const out: string[] = [];
  const firstMonday = monday(from);
  for (let d = from; d <= until && out.length < max; d = addDays(d, 1)) {
    const week = Math.round(daysBetween(firstMonday, monday(d)) / 7);
    if (week % every === 0 && weekdays.includes(d.getDay())) out.push(toIso(d));
  }
  return out;
}
