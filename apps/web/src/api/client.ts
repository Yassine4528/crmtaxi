export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onSessionLost: () => void = () => {};
export const setSessionLostHandler = (handler: () => void) => {
  onSessionLost = handler;
};

interface Options {
  /** Requête automatique : ne prolonge pas la session côté serveur. */
  background?: boolean;
  /** Une erreur 401 est une réponse attendue (connexion, vérification de session). */
  expectUnauthorized?: boolean;
}

async function request<T>(method: string, url: string, body?: unknown, options: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.background ? { 'X-Background': '1' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez votre connexion.');
  }
  if (res.status === 401 && !options.expectUnauthorized) onSessionLost();
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Une erreur est survenue.');
  return data as T;
}

export const api = {
  /** Les lectures sont automatiques : seule l'activité réelle de l'utilisateur prolonge sa session (voir useActivity). */
  get: <T>(url: string) => request<T>('GET', url, undefined, { background: true }),
  post: <T = unknown>(url: string, body?: unknown, options?: Options) => request<T>('POST', url, body ?? {}, options),
  put: <T = unknown>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T = unknown>(url: string, body: unknown) => request<T>('PATCH', url, body),
  delete: <T = unknown>(url: string) => request<T>('DELETE', url),
  /** Signale une activité réelle au serveur. */
  ping: () => request('GET', '/api/auth/me'),
  me: <T>() => request<T>('GET', '/api/auth/me', undefined, { expectUnauthorized: true, background: true }),
};
