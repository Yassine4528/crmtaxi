// Empêche de versionner l'ancienne application et les sauvegardes : elles contiennent des données de mineurs et des codes.
import { execFileSync } from 'node:child_process';

const FORBIDDEN = [/(^|\/)agenda\.html$/, /sauvegarde.*\.json$/i, /backup.*\.json$/i, /(^|\/)\.env$/, /(^|\/)\.data\//];

const tracked = execFileSync('git', ['ls-files', '--cached'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const offending = tracked.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));

if (offending.length) {
  console.error(`Fichiers privés suivis par Git :\n${offending.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`Aucun fichier privé parmi les ${tracked.length} fichiers suivis.`);
