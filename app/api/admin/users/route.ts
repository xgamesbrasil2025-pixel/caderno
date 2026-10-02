import { and, desc, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activities,
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
import { curriculum } from "@/lib/curriculum";
import { deleteSummaryImages } from "@/lib/image-storage";
import { AuthError, LEGACY_OWNER_ID, authErrorResponse, hashPassword, requireAdmin, requireSameOrigin, validatePassword } from "@/lib/auth";

const totalTopics = curriculum.reduce((sum, subject) => sum + subject.topics.length, 0);
const safeText = (value: unknown, max = 200) => typeof value === "string" ? value.slice(0, max) : "";

function baseStats(
  userId: string,
  topics: Array<typeof topicState.$inferSelect>,
  savedSummaries: Array<typeof summaries.$inferSelect>,
  cards: Array<typeof flashcards.$inferSelect>,
) {
  const userTopics = topics.filter((item) => item.userId === userId);
  const userSummaries = savedSummaries.filter((item) => item.userId === userId);
  const userCards = cards.filter((item) => item.userId === userId);
  const studiedTopicIds = new Set(userSummaries.map((item) => item.topicId));
  return {
    progress: totalTopics ? Math.round((studiedTopicIds.size / totalTopics) * 100) : 0,
    studiedTopics: studiedTopicIds.size,
    completedTopics: userTopics.filter((item) => item.completed).length,
    summaries: userSummaries.length,
    reviews: userSummaries.filter((item) => item.reviewText.trim()).length,
    flashcards: userCards.length,
    reviewedFlashcards: userCards.filter((item) => item.lastReviewedAt).length,
    totalSeconds: userTopics.reduce((sum, item) => sum + item.totalSeconds, 0),
  };
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = await getDb();
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
    const selectedUserId = (url.searchParams.get("userId") || "").slice(0, 80);
    const [userRows, topics, savedSummaries, cards] = await Promise.all([
      db.select().from(users).where(ne(users.id, LEGACY_OWNER_ID)).orderBy(desc(users.createdAt)),
      db.select().from(topicState),
      db.select().from(summaries),
      db.select().from(flashcards),
    ]);
    const visibleUsers = userRows
      .filter((user) => !query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerifiedAt: user.emailVerifiedAt,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
        lastAccessAt: user.lastAccessAt,
        stats: baseStats(user.id, topics, savedSummaries, cards),
      }));

    if (!selectedUserId) return Response.json({ users: visibleUsers }, { headers: { "Cache-Control": "no-store" } });
    const selected = userRows.find((user) => user.id === selectedUserId);
    if (!selected) throw new AuthError(404, "Usuário não encontrado.");
    const userTopics = topics.filter((item) => item.userId === selected.id);
    const userSummaries = savedSummaries.filter((item) => item.userId === selected.id);
    const userCards = cards.filter((item) => item.userId === selected.id);
    const [recentActivities, scheduleBlocks] = await Promise.all([
      db.select().from(activities).where(eq(activities.userId, selected.id)).orderBy(desc(activities.createdAt)).limit(12),
      db.select().from(studyScheduleBlocks).where(eq(studyScheduleBlocks.userId, selected.id)).orderBy(studyScheduleBlocks.position),
    ]);
    const subjectProgress = curriculum.map((subject) => {
      const ids = new Set(subject.topics.map((topic) => topic.id));
      const studied = new Set(userSummaries.filter((summary) => ids.has(summary.topicId)).map((summary) => summary.topicId)).size;
      const seconds = userTopics.filter((topic) => ids.has(topic.topicId)).reduce((sum, topic) => sum + topic.totalSeconds, 0);
      return { id: subject.id, name: subject.name, studied, total: subject.topics.length, seconds };
    });
    return Response.json({
      users: visibleUsers,
      selected: {
        id: selected.id,
        name: selected.name,
        email: selected.email,
        role: selected.role,
        status: selected.status,
        emailVerifiedAt: selected.emailVerifiedAt,
        mustChangePassword: selected.mustChangePassword,
        createdAt: selected.createdAt,
        lastAccessAt: selected.lastAccessAt,
        stats: baseStats(selected.id, topics, savedSummaries, cards),
        subjectProgress,
        recentActivities,
        scheduleBlocks,
        dueFlashcards: userCards.filter((card) => card.dueAt <= new Date().toISOString()).length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    const admin = await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const userId = safeText(body.userId, 80);
    const action = safeText(body.action, 30) || "setStatus";
    if (!userId) throw new AuthError(400, "Usuário inválido.");
    if (userId === admin.id && action === "resetPassword") throw new AuthError(400, "Altere sua própria senha entrando normalmente na conta.");
    const db = await getDb();
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw new AuthError(404, "Usuário não encontrado.");
    const timestamp = new Date().toISOString();

    if (action === "resetPassword") {
      const password = validatePassword(body.password);
      if (password !== safeText(body.confirmPassword, 128)) throw new AuthError(400, "As senhas não coincidem.");
      await db.batch([
        db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true, updatedAt: timestamp }).where(eq(users.id, userId)),
        db.delete(userSessions).where(eq(userSessions.userId, userId)),
      ]);
      return Response.json({ ok: true, mustChangePassword: true });
    }

    const status = safeText(body.status, 20);
    if (!["PENDING", "ACTIVE", "BLOCKED"].includes(status)) throw new AuthError(400, "Alteração inválida.");
    if (userId === admin.id && status === "BLOCKED") throw new AuthError(400, "Você não pode bloquear sua própria conta.");
    await db.update(users).set({
      status: status as "PENDING" | "ACTIVE" | "BLOCKED",
      emailVerifiedAt: status === "ACTIVE" ? target.emailVerifiedAt || timestamp : target.emailVerifiedAt,
      updatedAt: timestamp,
    }).where(eq(users.id, userId));
    if (status === "BLOCKED") await db.delete(userSessions).where(eq(userSessions.userId, userId));
    return Response.json({ ok: true, status });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const admin = await requireAdmin(request);
    const body = await request.json() as Record<string, unknown>;
    const userId = safeText(body.userId, 80);
    if (!userId) throw new AuthError(400, "Usuário inválido.");
    if (userId === admin.id) throw new AuthError(400, "Você não pode excluir sua própria conta.");
    const db = await getDb();
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw new AuthError(404, "Usuário não encontrado.");
    const ownedSummaries = await db.select().from(summaries).where(eq(summaries.userId, userId));
    const imageIds = [...new Set(ownedSummaries.flatMap((summary) =>
      [...summary.contentHtml.matchAll(/data-summary-image=["']([0-9a-f-]{36})["']/gi)].map((match) => match[1])
    ))];
    await db.batch([
      db.delete(topicState).where(eq(topicState.userId, userId)),
      db.delete(summaries).where(eq(summaries.userId, userId)),
      db.delete(activities).where(eq(activities.userId, userId)),
      db.delete(studyLogs).where(eq(studyLogs.userId, userId)),
      db.delete(errorNotes).where(eq(errorNotes.userId, userId)),
      db.delete(flashcards).where(eq(flashcards.userId, userId)),
      db.delete(studyScheduleSettings).where(eq(studyScheduleSettings.userId, userId)),
      db.delete(studyScheduleBlocks).where(eq(studyScheduleBlocks.userId, userId)),
      db.delete(userSessions).where(eq(userSessions.userId, userId)),
      db.delete(authTokens).where(eq(authTokens.userId, userId)),
      db.delete(users).where(and(eq(users.id, userId), ne(users.id, admin.id))),
    ]);
    if (imageIds.length) try { await deleteSummaryImages(imageIds); } catch { /* banco já foi limpo */ }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
