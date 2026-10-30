import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { normalize, type SessionUser } from '@taxi-crm/domain';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db/client.ts';
import { sessions, users } from './db/schema.ts';
import { HttpError, forbidden } from './lib/http.ts';
import { DUMMY_HASH, hashPassword, verifyPassword } from './lib/password.ts';

export const SESSION_COOKIE = 'taxi_session';
export const ADMIN_LOGIN = 'gerant';

/** Le gérant est déconnecté après 15 minutes sans activité : son poste peut être partagé. */
export const ADMIN_IDLE_MS = 15 * 60_000;
export const DRIVER_IDLE_MS = 12 * 3600_000;

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;
const TOUCH_INTERVAL_MS = 30_000;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const toSessionUser = (u: typeof users.$inferSelect): SessionUser => ({
  id: u.id,
  name: u.name,
  role: u.role,
  canAdd: u.role === 'admin' || u.canAdd,
  canDelete: u.role === 'admin' || u.canDelete,
});

export const requireUser = (req: FastifyRequest): SessionUser => {
  if (!req.user) throw new HttpError(401, 'Session expirée, veuillez vous reconnecter.');
  return req.user;
};

export const requireAdmin = (req: FastifyRequest): SessionUser => {
  const user = requireUser(req);
  if (user.role !== 'admin') throw forbidden();
  return user;
};

/** Crée le compte gérant au premier démarrage. */
export async function ensureAdmin(db: Db, initialPassword: string | undefined): Promise<boolean> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (existing) return true;
  if (!initialPassword) return false;
  await db.insert(users).values({
    id: randomUUID(),
    name: 'Gérant',
    login: ADMIN_LOGIN,
    role: 'admin',
    passwordHash: await hashPassword(initialPassword),
    canAdd: true,
    canDelete: true,
  });
  return true;
}

/** Résout la session à partir du cookie. Les rafraîchissements automatiques ne prolongent pas l'inactivité. */
export function registerSessionHook(app: FastifyInstance, db: Db): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token || !req.url.startsWith('/api/')) return;
    const tokenHash = hashToken(token);
    const [row] = await db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    if (!row) return;
    const idle = Date.now() - row.session.lastSeenAt.getTime();
    if (idle > (row.user.role === 'admin' ? ADMIN_IDLE_MS : DRIVER_IDLE_MS)) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
      return;
    }
    req.user = toSessionUser(row.user);
    if (!req.headers['x-background'] && idle > TOUCH_INTERVAL_MS) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
    }
  });
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure });
}

export async function login(
  db: Db,
  reply: FastifyReply,
  credentials: { login: string; password: string },
  secure: boolean,
): Promise<SessionUser> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.login, normalize(credentials.login)))
    .limit(1);

  if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new HttpError(429, 'Trop de tentatives : réessayez dans quelques minutes.');
  }
  const ok = await verifyPassword(credentials.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) {
    if (user) {
      const attempts = user.failedAttempts + 1;
      await db
        .update(users)
        .set({
          failedAttempts: attempts >= MAX_ATTEMPTS ? 0 : attempts,
          lockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS) : null,
        })
        .where(eq(users.id, user.id));
    }
    throw new HttpError(401, 'Identifiant ou code incorrect.');
  }

  await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId: user.id });
  // nettoyage opportuniste des sessions périmées
  await db.delete(sessions).where(lt(sessions.lastSeenAt, sql`now() - interval '2 days'`));
  setSessionCookie(reply, token, secure);
  return toSessionUser(user);
}

export async function logout(db: Db, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[SESSION_COOKIE];
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function changePassword(
  db: Db,
  req: FastifyRequest,
  userId: string,
  current: string,
  next: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) {
    throw new HttpError(400, 'Mot de passe actuel incorrect.');
  }
  const token = req.cookies[SESSION_COOKIE] ?? '';
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(next) })
      .where(eq(users.id, userId));
    // les autres sessions de ce compte sont fermées
    await tx
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), sql`${sessions.tokenHash} <> ${hashToken(token)}`));
  });
}

/** Ferme toutes les sessions d'un compte (code modifié ou retiré). */
export const closeSessions = (db: Db, userId: string) => db.delete(sessions).where(eq(sessions.userId, userId));
