import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  AuthError,
  adminRoleForEmail,
  authErrorResponse,
  checkRateLimit,
  claimLegacyStudyData,
  clearExpiredAuthData,
  clearSessionCookie,
  createSession,
  destroyCurrentSession,
  getCurrentUser,
  hashPassword,
  requireSameOrigin,
  validateEmail,
  validateName,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";

const safeText = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

function sessionUser(user: typeof users.$inferSelect) {
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

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40);
    const db = await getDb();

    if (action === "register") {
      const name = validateName(body.name);
      const email = validateEmail(body.email);
      const password = validatePassword(body.password);
      if (password !== safeText(body.confirmPassword, 128)) throw new AuthError(400, "As senhas não coincidem.");
      await checkRateLimit(request, action, email, 5);
      const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (existing) throw new AuthError(409, "Já existe uma conta com este e-mail.");

      const timestamp = new Date().toISOString();
      const userId = crypto.randomUUID();
      const role = adminRoleForEmail(email);
      const status = role === "admin" ? "ACTIVE" as const : "PENDING" as const;
      await db.insert(users).values({
        id: userId,
        name,
        email,
        passwordHash: await hashPassword(password),
        role,
        status,
        emailVerifiedAt: role === "admin" ? timestamp : null,
        mustChangePassword: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastAccessAt: role === "admin" ? timestamp : null,
      });

      if (role === "admin") {
        await claimLegacyStudyData(userId);
        const [created] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        const cookie = await createSession(request, userId, true);
        return Response.json({ ok: true, user: sessionUser(created) }, { headers: { "Set-Cookie": cookie } });
      }

      return Response.json({
        ok: true,
        pending: true,
        message: "Conta criada. Aguarde a aprovação do administrador para entrar.",
      });
    }

    if (action === "login") {
      const email = validateEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      await checkRateLimit(request, action, email, 8);
      const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AuthError(401, "E-mail ou senha incorretos.");
      if (user.status === "PENDING") throw new AuthError(403, "Sua conta ainda aguarda aprovação do administrador.");
      if (user.status === "BLOCKED") throw new AuthError(403, "Esta conta está bloqueada. Fale com o administrador.");
      const timestamp = new Date().toISOString();
      await db.update(users).set({ lastAccessAt: timestamp, updatedAt: timestamp }).where(eq(users.id, user.id));
      user.lastAccessAt = timestamp;
      const cookie = await createSession(request, user.id, Boolean(body.remember));
      return Response.json({ ok: true, user: sessionUser(user) }, { headers: { "Set-Cookie": cookie } });
    }

    if (action === "changePassword") {
      const current = await getCurrentUser(request);
      if (!current) throw new AuthError(401, "Entre com a senha temporária para continuar.");
      const password = validatePassword(body.password);
      if (password !== safeText(body.confirmPassword, 128)) throw new AuthError(400, "As senhas não coincidem.");
      const timestamp = new Date().toISOString();
      await db.update(users).set({
        passwordHash: await hashPassword(password),
        mustChangePassword: false,
        updatedAt: timestamp,
      }).where(eq(users.id, current.id));
      const [updated] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
      return Response.json({ ok: true, user: sessionUser(updated), message: "Nova senha salva." });
    }

    if (action === "updateProfile") {
      const current = await getCurrentUser(request);
      if (!current) throw new AuthError(401, "Entre novamente para editar seu perfil.");
      const name = validateName(body.name);
      const email = validateEmail(body.email);
      const currentPassword = safeText(body.currentPassword, 128);
      const newPasswordText = safeText(body.newPassword, 128);
      const confirmNewPassword = safeText(body.confirmNewPassword, 128);
      await checkRateLimit(request, action, current.email, 8);
      const [storedUser] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
      if (!storedUser || !(await verifyPassword(currentPassword, storedUser.passwordHash))) throw new AuthError(401, "A senha atual está incorreta.");
      const [emailOwner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (emailOwner && emailOwner.id !== current.id) throw new AuthError(409, "Já existe uma conta com este e-mail.");
      const timestamp = new Date().toISOString();
      const profileUpdate: Partial<typeof users.$inferInsert> = { name, email, updatedAt: timestamp };
      if (newPasswordText || confirmNewPassword) {
        const newPassword = validatePassword(newPasswordText);
        if (newPassword !== confirmNewPassword) throw new AuthError(400, "As novas senhas não coincidem.");
        profileUpdate.passwordHash = await hashPassword(newPassword);
      }
      await db.update(users).set(profileUpdate).where(eq(users.id, current.id));
      const [updated] = await db.select().from(users).where(eq(users.id, current.id)).limit(1);
      return Response.json({ ok: true, user: sessionUser(updated), message: "Perfil atualizado." });
    }

    if (action === "forgotPassword") {
      const email = validateEmail(body.email);
      await checkRateLimit(request, action, email, 4);
      return Response.json({
        ok: true,
        message: "Peça ao administrador para criar uma senha temporária para esta conta.",
      });
    }

    if (action === "logout") {
      await destroyCurrentSession(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie(request) } });
    }

    throw new AuthError(400, "Ação inválida.");
  } catch (error) {
    return authErrorResponse(error);
  } finally {
    void clearExpiredAuthData().catch(() => undefined);
  }
}
