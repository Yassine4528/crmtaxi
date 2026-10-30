import { useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@taxi-crm/domain';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, setSessionLostHandler } from './api/client.ts';

/** Le gérant est déconnecté après 15 minutes sans activité (règle aussi appliquée par le serveur). */
const ADMIN_IDLE_MS = 15 * 60_000;
const PING_INTERVAL_MS = 60_000;

interface Session {
  user: SessionUser;
  isAdmin: boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession hors de SessionProvider');
  return session;
}

/** Interrupteur de session : quand elle se termine, tout l'écran est démonté et le cache vidé. */
export function useAuthState() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  const clear = useCallback(() => {
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setSessionLostHandler(clear);
    api
      .me<{ user: SessionUser }>()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, [clear]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    clear();
  }, [clear]);

  return { user, setUser, logout };
}

export function SessionProvider(props: { user: SessionUser; logout: () => Promise<void>; children: ReactNode }) {
  const { user, logout, children } = props;
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastPing.current > PING_INTERVAL_MS) {
        lastPing.current = now;
        void api.ping().catch(() => undefined);
      }
    };
    const events = ['mousedown', 'keydown', 'touchstart'] as const;
    events.forEach((t) => document.addEventListener(t, onActivity, true));
    const timer = isAdmin
      ? setInterval(() => {
          if (Date.now() - lastActivity.current > ADMIN_IDLE_MS) void logout();
        }, 30_000)
      : undefined;
    return () => {
      events.forEach((t) => document.removeEventListener(t, onActivity, true));
      clearInterval(timer);
    };
  }, [isAdmin, logout]);

  const value = useMemo(() => ({ user, isAdmin, logout }), [user, isAdmin, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
