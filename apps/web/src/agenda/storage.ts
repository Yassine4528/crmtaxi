/** Préférences d'affichage propres à ce navigateur : l'application fonctionne sans, si le stockage est bloqué. */
export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // préférence non conservée : sans conséquence
    }
  },
};
