/** Arrondi au centime, en corrigeant les erreurs de représentation (1,005 → 1,01). */
export const round2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;

export const formatEuros = (x: number): string =>
  `${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** 12.5 → « 12,5 », pour les champs de saisie */
export const formatAmountInput = (x: number | undefined): string => String(round2(Number(x) || 0)).replace('.', ',');

/** Lit un montant saisi à la française ; 0 si illisible. */
export function parseAmount(s: string): number {
  const v = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(v) ? 0 : v;
}

export const excludingVat = (ttc: number, vatPercent: number): number => round2(ttc / (1 + vatPercent / 100));

const UNITS = [
  'zéro',
  'un',
  'deux',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  if (n < 70) {
    const u = n % 10;
    return TENS[Math.floor(n / 10)]! + (u === 0 ? '' : u === 1 ? ' et un' : `-${UNITS[u]}`);
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${below100(n - 60)}`;
  return n === 80 ? 'quatre-vingts' : `quatre-vingt-${below100(n - 80)}`;
}

function below1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds === 0 ? '' : hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent${rest === 0 ? 's' : ''}`;
  return rest ? (head ? `${head} ` : '') + below100(rest) : head;
}

/** Nombre entier positif en toutes lettres. */
export function integerInWords(n: number): string {
  if (n === 0) return 'zéro';
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? 'un million' : `${below1000(millions)} millions`);
  if (thousands) {
    parts.push(thousands === 1 ? 'mille' : `${below1000(thousands).replace(/(cent|vingt)s$/, '$1')} mille`);
  }
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** Montant en toutes lettres, pour la mention « certifié sincère » du mémoire. */
export function amountInWords(x: number): string {
  const cents = Math.round(x * 100);
  const euros = Math.floor(cents / 100);
  const c = cents % 100;
  return (
    `${integerInWords(euros)} euro${euros > 1 ? 's' : ''}` +
    (c ? ` et ${integerInWords(c)} centime${c > 1 ? 's' : ''}` : '')
  );
}
