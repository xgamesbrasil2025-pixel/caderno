import "server-only";

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activities,
  authRateLimits,
  authTokens,
  errorNotes,
  flashcards,
  studyLogs,
  studyScheduleBlocks,
  studyScheduleSettings,
  summaries,
  topicState,
  userSessions,
  users,
} from "@/db/schema";

export const SESSION_COOKIE = "pmba_session";
export const LEGACY_OWNER_ID = "__legacy_owner__";
// The production Workers runtime caps a single PBKDF2 operation at 100,000 iterations.
const PASSWORD_ITERATIONS = 100_000;
const SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 24;

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: "PENDING" | "ACTIVE" | "BLOCKED";
  emailVerifiedAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  lastAccessAt: string | null;
};

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

export function validateName(value: unknown) {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 100) : "";
  if (name.length < 2) throw new AuthError(400, "Informe seu nome.");
  return name;
}

export function validateEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, "Informe um e-mail válido.");
  return email;
}

export function validatePassword(value: unknown) {
  const password = typeof value === "string" ? value : "";
  if (password.length < 8 || password.length > 128 || !/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    throw new AuthError(400, "A senha precisa ter de 8 a 128 caracteres, com letras e números.");
  }
  return password;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationsText, saltText, hashText] = stored.split("$");
  const iterations = Number(iterationsText);
  if (algorithm !== "pbkdf2-sha256" || !Number.isInteger(iterations) || !saltText || !hashText) return false;
  try {
    const expected = base64UrlToBytes(hashText);
    const actual = await derivePassword(password, base64UrlToBytes(saltText), iterations);
    if (expected.length !== actual.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ actual[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export function randomToken() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToBase64Url(new Uint8Array(digest));
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function publicUser(user: typeof users.$inferSelect): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
    lastAccessAt: user.lastAccessAt,
  };
}

export function adminRoleForEmail(email: string): "admin" | "user" {
  const configured = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
  return configured.includes(normalizeEmail(email)) ? "admin" : "user";
}

export async function createSession(request: Request, userId: string, remember: boolean) {
  const db = await getDb();
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const createdAt = new Date();
  const durationMs = remember ? SESSION_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000;
  const expiresAt = new Date(createdAt.getTime() + durationMs);
  await db.insert(userSessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    createdAt: createdAt.toISOString(),
    lastSeenAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${Math.floor(durationMs / 1000)}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
}

export async function destroyCurrentSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  const db = await getDb();
  await db.delete(userSessions).where(eq(userSessions.tokenHash, await hashToken(token)));
}

export async function getCurrentUser(request: Request): Promise<AuthUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const db = await getDb();
  const tokenHash = await hashToken(token);
  const [session] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, tokenHash)).limit(1);
  if (!session) return null;
  const now = new Date();
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    await db.delete(userSessions).where(eq(userSessions.id, session.id));
    return null;
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;
  if (user.status !== "ACTIVE") {
    await db.delete(userSessions).where(eq(userSessions.userId, user.id));
    throw new AuthError(403, user.status === "PENDING" ? "Sua conta ainda aguarda aprovação do administrador." : "Esta conta está bloqueada. Fale com o administrador.");
  }
  if (now.getTime() - new Date(session.lastSeenAt).getTime() > 5 * 60_000) {
    const timestamp = now.toISOString();
    await db.batch([
      db.update(userSessions).set({ lastSeenAt: timestamp }).where(eq(userSessions.id, session.id)),
      db.update(users).set({ lastAccessAt: timestamp, updatedAt: timestamp }).where(eq(users.id, user.id)),
    ]);
    user.lastAccessAt = timestamp;
  }
  return publicUser(user);
}

export async function requireUser(request: Request) {
  const user = await getCurrentUser(request);
  if (!user) throw new AuthError(401, "Entre na sua conta para continuar.");
  if (user.mustChangePassword) throw new AuthError(403, "Altere sua senha temporária para continuar.");
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new AuthError(403, "Acesso restrito à administração.");
  return user;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new AuthError(403, "Requisição não autorizada.");

  const requestUrl = new URL(request.url);
  const allowedOrigins = new Set([requestUrl.origin]);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const protocol = forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : requestUrl.protocol.replace(":", "");
    allowedOrigins.add(`${protocol}://${forwardedHost}`);
  }

  if (!allowedOrigins.has(origin)) throw new AuthError(403, "Requisição não autorizada.");
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error) {
    console.error("Unexpected authentication error", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  } else {
    console.error("Unexpected authentication error", { value: String(error) });
  }
  return Response.json({ error: "Não foi possível autenticar agora." }, { status: 503 });
}

export async function createAuthToken(userId: string, kind: "verify_email" | "reset_password", lifetimeMs: number) {
  const db = await getDb();
  const token = randomToken();
  const timestamp = new Date();
  await db.batch([
    db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind))),
    db.insert(authTokens).values({
      id: crypto.randomUUID(),
      userId,
      kind,
      tokenHash: await hashToken(token),
      createdAt: timestamp.toISOString(),
      expiresAt: new Date(timestamp.getTime() + lifetimeMs).toISOString(),
    }),
  ]);
  return token;
}

export async function consumeAuthToken(token: string, kind: "verify_email" | "reset_password") {
  const db = await getDb();
  const timestamp = new Date().toISOString();
  const [row] = await db.select().from(authTokens).where(and(
    eq(authTokens.tokenHash, await hashToken(token)),
    eq(authTokens.kind, kind),
  )).limit(1);
  if (!row || row.usedAt || row.expiresAt <= timestamp) throw new AuthError(400, "Este link é inválido ou expirou.");
  await db.update(authTokens).set({ usedAt: timestamp }).where(eq(authTokens.id, row.id));
  return row.userId;
}

export async function checkRateLimit(request: Request, action: string, identity: string, maximum: number) {
  const db = await getDb();
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const keyHash = await hashToken(`${action}:${address}:${normalizeEmail(identity)}`);
  const now = new Date();
  const [row] = await db.select().from(authRateLimits).where(eq(authRateLimits.keyHash, keyHash)).limit(1);
  if (row?.blockedUntil && new Date(row.blockedUntil).getTime() > now.getTime()) {
    throw new AuthError(429, "Muitas tentativas. Aguarde alguns minutos.");
  }
  const windowExpired = !row || now.getTime() - new Date(row.windowStartedAt).getTime() > 15 * 60_000;
  const attempts = windowExpired ? 1 : row.attempts + 1;
  const blockedUntil = attempts > maximum ? new Date(now.getTime() + 15 * 60_000).toISOString() : null;
  await db.insert(authRateLimits).values({
    keyHash,
    attempts,
    windowStartedAt: windowExpired ? now.toISOString() : row!.windowStartedAt,
    blockedUntil,
  }).onConflictDoUpdate({
    target: authRateLimits.keyHash,
    set: { attempts, windowStartedAt: windowExpired ? now.toISOString() : row!.windowStartedAt, blockedUntil },
  });
  if (blockedUntil) throw new AuthError(429, "Muitas tentativas. Aguarde alguns minutos.");
}

export async function clearExpiredAuthData() {
  const db = await getDb();
  const timestamp = new Date().toISOString();
  await db.batch([
    db.delete(userSessions).where(lt(userSessions.expiresAt, timestamp)),
    db.delete(authTokens).where(lt(authTokens.expiresAt, timestamp)),
  ]);
}

export async function claimLegacyStudyData(userId: string) {
  const db = await getDb();
  await db.batch([
    db.update(topicState).set({ userId }).where(eq(topicState.userId, LEGACY_OWNER_ID)),
    db.update(summaries).set({ userId }).where(eq(summaries.userId, LEGACY_OWNER_ID)),
    db.update(activities).set({ userId }).where(eq(activities.userId, LEGACY_OWNER_ID)),
    db.update(studyLogs).set({ userId }).where(eq(studyLogs.userId, LEGACY_OWNER_ID)),
    db.update(errorNotes).set({ userId }).where(eq(errorNotes.userId, LEGACY_OWNER_ID)),
    db.update(flashcards).set({ userId }).where(eq(flashcards.userId, LEGACY_OWNER_ID)),
    db.update(studyScheduleSettings).set({ userId }).where(eq(studyScheduleSettings.userId, LEGACY_OWNER_ID)),
    db.update(studyScheduleBlocks).set({ userId }).where(eq(studyScheduleBlocks.userId, LEGACY_OWNER_ID)),
  ]);
}
