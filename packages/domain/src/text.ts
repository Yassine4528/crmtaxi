import { capitalize } from './dates.ts';

/** Comparaison sans casse ni accents (« elodie » = « Élodie »). */
export const normalize = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Identifiant canonique d'une combinaison de jeunes, indépendant de l'ordre. */
export const ridersKey = (names: string[]): string => names.map(normalize).sort().join(',');

/** « Ana - Leo -Mia » → ['Ana', 'Leo', 'Mia'] ; « Pas de transport » → [] */
export function parseRiderNames(text: string): string[] {
  const out: string[] = [];
  if (/^\s*pas de transport\s*$/i.test(text)) return out;
  text
    .split(/\s*[-+]\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((raw) => {
      const name = capitalize(raw);
      if (!out.some((x) => normalize(x) === normalize(name))) out.push(name);
    });
  return out;
}

/** « Zoé (matin), Tom » → [{ name: 'Zoé', label: 'matin' }, { name: 'Tom', label: '' }] */
export function parseTripRiders(text: string): { name: string; label: string }[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)\s*\((.*)\)\s*$/);
      return m ? { name: m[1]!.trim(), label: m[2]!.trim() } : { name: s, label: '' };
    });
}

export const formatTripRiders = (riders: { name: string; label: string }[]): string =>
  riders.map((r) => r.name + (r.label ? ` (${r.label})` : '')).join(', ');
