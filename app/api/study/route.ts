import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, errorNotes, flashcards, studyLogs, studyScheduleBlocks, studyScheduleSettings, summaries, topicState } from "@/db/schema";
import { AuthError, authErrorResponse, requireSameOrigin, requireUser } from "@/lib/auth";
import { curriculum } from "@/lib/curriculum";
import { enhanceStudyReview, generateErrorFlashcards, OpenAIStudyError } from "@/lib/openai-study";
import { deleteSummaryImages } from "@/lib/image-storage";

const now = () => new Date().toISOString();
const scheduleDays = ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo"];
const scheduleDaySet = new Set(scheduleDays);
const subjectIdSet = new Set(curriculum.map((subject) => subject.id));
const safeText = (value: unknown, max = 200000) => typeof value === "string" ? value.slice(0, max) : "";

function safeStringList(value: unknown, allowed: Set<string>, max = 20) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeText(item, 80)).filter((item) => allowed.has(item)))].slice(0, max);
}

function parseStoredList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeScheduleBlocks(value: unknown, timestamp: string, userId: string) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).flatMap((item, index) => {
    const candidate = item as Record<string, unknown>;
    const id = safeText(candidate.id, 80);
    const day = safeText(candidate.day, 20);
    const subjectId = safeText(candidate.subjectId, 80);
    if (!id || !scheduleDaySet.has(day) || !subjectIdSet.has(subjectId)) return [];
    return [{ id, userId, day, subjectId, startMinutes: Math.max(0, Math.min(1439, Math.round(Number(candidate.startMinutes) || 0))), durationMinutes: Math.max(15, Math.min(720, Math.round(Number(candidate.durationMinutes) || 60))), position: Math.max(0, Math.min(79, Math.round(Number(candidate.position) || index))), createdAt: safeText(candidate.createdAt, 40) || timestamp, updatedAt: timestamp }];
  });
}

function curriculumTopic(subjectId: string, topicId: string) {
  const subject = curriculum.find((item) => item.id === subjectId);
  const topic = subject?.topics.find((item) => item.id === topicId);
  if (!subject || !topic) throw new AuthError(400, "Selecione uma matéria e um tópico válidos.");
  return { subject, topic };
}

function requestError(error: unknown) {
  if (error instanceof AuthError) return authErrorResponse(error);
  if (error instanceof OpenAIStudyError) return Response.json({ error: error.publicMessage }, { status: error.httpStatus });
  console.error("Study API failure", error);
  const message = error instanceof Error ? error.message : "Falha desconhecida";
  const unavailable = message.includes("no such table") || message.includes("binding `DB`");
  return Response.json({ error: unavailable ? "O caderno está preparando o armazenamento. Tente novamente em instantes." : "Não foi possível salvar agora." }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40);

    if (action === "enhanceReview" || action === "generateReview") {
      const subjectName = safeText(body.subjectName, 120);
      const topicName = safeText(body.topicName, 1200);
      const summaryHtml = safeText(body.summaryHtml, 20000);
      if (!subjectName || !topicName) throw new AuthError(400, "Tópico inválido.");
      const generated = await enhanceStudyReview({ subjectName, topicName, summaryHtml });
      return Response.json(generated, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "createError") {
      const subjectId = safeText(body.subjectId, 80);
      const topicId = safeText(body.topicId, 80);
      const { subject, topic } = curriculumTopic(subjectId, topicId);
      const title = safeText(body.title, 120).trim() || "Erro registrado";
      const mistake = safeText(body.mistake, 4000).trim();
      const correctAnswer = safeText(body.correctAnswer, 4000).trim();
      const reason = safeText(body.reason, 2400).trim();
      const generated = await generateErrorFlashcards({ subjectName: subject.name, topicName: topic.name, title, mistake, correctAnswer, reason });
      const timestamp = now();
      const errorId = crypto.randomUUID();
      const sourceReview = [correctAnswer, reason].filter(Boolean).join(" — ");
      const note = { id: errorId, userId: user.id, subjectId, topicId, subjectName: subject.name, topicName: topic.name, priority: topic.priority, title, mistake, correctAnswer, reason, createdAt: timestamp, updatedAt: timestamp };
      const db = await getDb();
      await db.batch([
        db.insert(errorNotes).values(note),
        db.insert(flashcards).values(generated.flashcards.map((card) => ({ ...card, userId: user.id, topicId, sourceSummaryId: null, sourceErrorId: errorId, topicName: topic.name, subjectName: subject.name, priority: topic.priority, sourceReview, dueAt: timestamp, createdAt: timestamp }))),
        db.insert(activities).values({ userId: user.id, type: "Erro salvo com flashcards", topicId, topicName: topic.name, subjectName: subject.name, createdAt: timestamp }),
      ]);
      return Response.json({ note, flashcards: generated.flashcards, generationId: generated.generationId, model: generated.model }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (action === "regenerateError") {
      const errorId = safeText(body.errorId, 80);
      const db = await getDb();
      const [note] = await db.select().from(errorNotes).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))).limit(1);
      if (!note) throw new AuthError(404, "Erro não encontrado.");
      const generated = await generateErrorFlashcards({ subjectName: note.subjectName, topicName: note.topicName, title: note.title, mistake: note.mistake, correctAnswer: note.correctAnswer, reason: note.reason });
      const timestamp = now();
      await db.batch([
        db.delete(flashcards).where(and(eq(flashcards.userId, user.id), eq(flashcards.sourceErrorId, errorId))),
        db.insert(flashcards).values(generated.flashcards.map((card) => ({ ...card, userId: user.id, topicId: note.topicId, sourceSummaryId: null, sourceErrorId: errorId, topicName: note.topicName, subjectName: note.subjectName, priority: note.priority, sourceReview: [note.correctAnswer, note.reason].filter(Boolean).join(" — "), dueAt: timestamp, createdAt: timestamp }))),
        db.update(errorNotes).set({ updatedAt: timestamp }).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))),
        db.insert(activities).values({ userId: user.id, type: "Flashcards do erro atualizados", topicId: note.topicId, topicName: note.topicName, subjectName: note.subjectName, createdAt: timestamp }),
      ]);
      return Response.json({ flashcards: generated.flashcards, generationId: generated.generationId, model: generated.model }, { headers: { "Cache-Control": "no-store" } });
    }

    throw new AuthError(400, "Ação inválida.");
  } catch (error) { return requestError(error); }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = await getDb();
    const [topics, savedSummaries, recent, cards, savedErrors, scheduleBlocks, scheduleRows] = await Promise.all([
      db.select().from(topicState).where(eq(topicState.userId, user.id)),
      db.select().from(summaries).where(eq(summaries.userId, user.id)).orderBy(desc(summaries.updatedAt), desc(summaries.createdAt)),
      db.select().from(activities).where(eq(activities.userId, user.id)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(8),
      db.select().from(flashcards).where(eq(flashcards.userId, user.id)).orderBy(flashcards.dueAt, flashcards.id),
      db.select().from(errorNotes).where(eq(errorNotes.userId, user.id)).orderBy(desc(errorNotes.updatedAt), desc(errorNotes.createdAt)),
      db.select().from(studyScheduleBlocks).where(eq(studyScheduleBlocks.userId, user.id)).orderBy(studyScheduleBlocks.position, studyScheduleBlocks.startMinutes),
      db.select().from(studyScheduleSettings).where(and(eq(studyScheduleSettings.userId, user.id), eq(studyScheduleSettings.id, "main"))).limit(1),
    ]);
    const scheduleRow = scheduleRows[0];
    const scheduleSettings = scheduleRow ? { availableDays: parseStoredList(scheduleRow.availableDays), minutesPerDay: scheduleRow.minutesPerDay, includedSubjectIds: parseStoredList(scheduleRow.includedSubjectIds), updatedAt: scheduleRow.updatedAt } : null;
    return Response.json({ topics, summaries: savedSummaries, activities: recent, flashcards: cards, errorNotes: savedErrors, scheduleBlocks, scheduleSettings });
  } catch (error) { return requestError(error); }
}

export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40);
    const topicId = safeText(body.topicId, 80);
    const topicName = safeText(body.topicName, 1200);
    const subjectName = safeText(body.subjectName, 120);
    const timestamp = now();
    const db = await getDb();

    if (action === "scheduleSave") {
      const availableDays = safeStringList(body.availableDays, scheduleDaySet, 7);
      const includedSubjectIds = safeStringList(body.includedSubjectIds, subjectIdSet, curriculum.length);
      const minutesPerDay = Math.max(30, Math.min(720, Math.round(Number(body.minutesPerDay) || 180)));
      const blocks = safeScheduleBlocks(body.blocks, timestamp, user.id);
      const clearBlocks = db.delete(studyScheduleBlocks).where(eq(studyScheduleBlocks.userId, user.id));
      const saveSettings = db.insert(studyScheduleSettings).values({ userId: user.id, id: "main", availableDays: JSON.stringify(availableDays), minutesPerDay, includedSubjectIds: JSON.stringify(includedSubjectIds), updatedAt: timestamp }).onConflictDoUpdate({ target: [studyScheduleSettings.userId, studyScheduleSettings.id], set: { availableDays: JSON.stringify(availableDays), minutesPerDay, includedSubjectIds: JSON.stringify(includedSubjectIds), updatedAt: timestamp } });
      const blockInsertQueries = [];
      for (let index = 0; index < blocks.length; index += 10) {
        blockInsertQueries.push(db.insert(studyScheduleBlocks).values(blocks.slice(index, index + 10)));
      }
      await db.batch([clearBlocks, saveSettings, ...blockInsertQueries]);
      return Response.json({ scheduleBlocks: blocks, scheduleSettings: { availableDays, minutesPerDay, includedSubjectIds, updatedAt: timestamp } });
    }

    if (action === "flashcard") {
      const id = Number(body.id);
      const [card] = await db.select().from(flashcards).where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id))).limit(1);
      if (!card) throw new AuthError(404, "Flashcard não encontrado.");
      const remembered = Boolean(body.remembered);
      const nextInterval = remembered ? (card.intervalDays < 1 ? 1 : Math.min(60, card.intervalDays * 2)) : 0;
      const due = new Date(Date.now() + (remembered ? nextInterval * 86400000 : 10 * 60000)).toISOString();
      await db.batch([
        db.update(flashcards).set({ intervalDays: nextInterval, dueAt: due, lastReviewedAt: timestamp }).where(and(eq(flashcards.id, id), eq(flashcards.userId, user.id))),
        db.insert(activities).values({ userId: user.id, type: remembered ? "Flashcard lembrado" : "Flashcard para reforçar", topicId: card.topicId, topicName: card.topicName, subjectName: card.subjectName, createdAt: timestamp }),
      ]);
      return Response.json({ ok: true, dueAt: due, intervalDays: nextInterval });
    }

    if (action === "errorUpdate") {
      const errorId = safeText(body.errorId, 80);
      const subjectId = safeText(body.subjectId, 80);
      const { subject, topic } = curriculumTopic(subjectId, topicId);
      const title = safeText(body.title, 120).trim() || "Erro registrado";
      const mistake = safeText(body.mistake, 4000).trim();
      const correctAnswer = safeText(body.correctAnswer, 4000).trim();
      const reason = safeText(body.reason, 2400).trim();
      if (mistake.length < 8 || correctAnswer.length < 8) throw new AuthError(400, "Descreva o erro e a resposta correta.");
      const [existing] = await db.select().from(errorNotes).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))).limit(1);
      if (!existing) throw new AuthError(404, "Erro não encontrado.");
      const sourceReview = [correctAnswer, reason].filter(Boolean).join(" — ");
      await db.batch([
        db.update(errorNotes).set({ subjectId, topicId, subjectName: subject.name, topicName: topic.name, priority: topic.priority, title, mistake, correctAnswer, reason, updatedAt: timestamp }).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))),
        db.update(flashcards).set({ topicId, topicName: topic.name, subjectName: subject.name, priority: topic.priority, sourceReview }).where(and(eq(flashcards.userId, user.id), eq(flashcards.sourceErrorId, errorId))),
        db.insert(activities).values({ userId: user.id, type: "Erro atualizado", topicId, topicName: topic.name, subjectName: subject.name, createdAt: timestamp }),
      ]);
      const [savedNote] = await db.select().from(errorNotes).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))).limit(1);
      return Response.json({ note: savedNote });
    }

    if (!topicId) throw new AuthError(400, "Tópico inválido.");
    if (action === "summary") {
      const summaryId = safeText(body.summaryId, 80) || crypto.randomUUID();
      const summaryMode = safeText(body.summaryMode, 12);
      const summaryTitle = safeText(body.summaryTitle, 120).trim() || "Resumo";
      const summaryHtml = safeText(body.summaryHtml);
      if (summaryMode !== "create" && summaryMode !== "update") throw new AuthError(400, "Modo de salvamento inválido.");
      const [existing] = await db.select().from(summaries).where(eq(summaries.id, summaryId)).limit(1);
      if (summaryMode === "create" && existing) throw new AuthError(409, "Este resumo já foi salvo. Abra-o e clique em Editar para alterá-lo.");
      if (summaryMode === "update" && (!existing || existing.userId !== user.id)) throw new AuthError(404, "Resumo não encontrado.");
      if (summaryMode === "update" && existing.topicId !== topicId) throw new AuthError(400, "Este resumo pertence a outro tópico.");
      const summaryWrite = summaryMode === "create"
        ? db.insert(summaries).values({ id: summaryId, userId: user.id, topicId, title: summaryTitle, contentHtml: summaryHtml, createdAt: timestamp, updatedAt: timestamp })
        : db.update(summaries).set({ title: summaryTitle, contentHtml: summaryHtml, updatedAt: timestamp }).where(and(eq(summaries.id, summaryId), eq(summaries.userId, user.id), eq(summaries.topicId, topicId)));
      const topicUpsert = db.insert(topicState).values({ userId: user.id, topicId, summaryHtml, updatedAt: timestamp }).onConflictDoUpdate({ target: [topicState.userId, topicState.topicId], set: { summaryHtml, updatedAt: timestamp } });
      if (body.recordActivity) await db.batch([summaryWrite, topicUpsert, db.insert(activities).values({ userId: user.id, type: summaryMode === "update" ? "Resumo atualizado" : "Novo resumo salvo", topicId, topicName, subjectName, createdAt: timestamp })]);
      else await db.batch([summaryWrite, topicUpsert]);
      const [savedSummary] = await db.select().from(summaries).where(and(eq(summaries.id, summaryId), eq(summaries.userId, user.id))).limit(1);
      const [savedTopic] = await db.select().from(topicState).where(and(eq(topicState.userId, user.id), eq(topicState.topicId, topicId))).limit(1);
      return Response.json({ topic: savedTopic, summary: savedSummary });
    }

    if (action === "review") {
      const summaryId = safeText(body.summaryId, 80);
      const reviewText = safeText(body.reviewText, 12000);
      const [sourceSummary] = summaryId ? await db.select().from(summaries).where(and(eq(summaries.id, summaryId), eq(summaries.topicId, topicId), eq(summaries.userId, user.id))).limit(1) : [];
      if (!sourceSummary) throw new AuthError(400, "Salve este resumo antes de salvar a revisão.");
      if (reviewText.length < 20) throw new AuthError(400, "Gere ou escreva uma revisão antes de salvar.");
      await db.batch([
        db.update(summaries).set({ reviewText, updatedAt: timestamp }).where(and(eq(summaries.id, summaryId), eq(summaries.userId, user.id))),
        db.insert(topicState).values({ userId: user.id, topicId, reviewText, updatedAt: timestamp }).onConflictDoUpdate({ target: [topicState.userId, topicState.topicId], set: { reviewText, updatedAt: timestamp } }),
        db.insert(activities).values({ userId: user.id, type: "Revisão aprimorada salva", topicId, topicName, subjectName, createdAt: timestamp }),
      ]);
    } else if (action === "completed") {
      const completed = Boolean(body.completed);
      await db.insert(topicState).values({ userId: user.id, topicId, completed, updatedAt: timestamp }).onConflictDoUpdate({ target: [topicState.userId, topicState.topicId], set: { completed, updatedAt: timestamp } });
      if (completed) await db.insert(activities).values({ userId: user.id, type: "Tópico concluído", topicId, topicName, subjectName, createdAt: timestamp });
    } else if (action === "time") {
      const seconds = Math.max(1, Math.min(86400, Number(body.seconds) || 0));
      await db.batch([
        db.insert(topicState).values({ userId: user.id, topicId, totalSeconds: seconds, updatedAt: timestamp }).onConflictDoUpdate({ target: [topicState.userId, topicState.topicId], set: { totalSeconds: sql`${topicState.totalSeconds} + ${seconds}`, updatedAt: timestamp } }),
        db.insert(studyLogs).values({ userId: user.id, topicId, seconds, studiedAt: timestamp }),
      ]);
    } else throw new AuthError(400, "Ação inválida.");

    const [saved] = await db.select().from(topicState).where(and(eq(topicState.userId, user.id), eq(topicState.topicId, topicId))).limit(1);
    return Response.json({ topic: saved });
  } catch (error) { return requestError(error); }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = safeText(body.action, 40);
    const db = await getDb();
    if (action === "error") {
      const errorId = safeText(body.errorId, 80);
      const [existingError] = await db.select().from(errorNotes).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))).limit(1);
      if (!existingError) throw new AuthError(404, "Erro não encontrado.");
      await db.batch([
        db.delete(flashcards).where(and(eq(flashcards.userId, user.id), eq(flashcards.sourceErrorId, errorId))),
        db.delete(errorNotes).where(and(eq(errorNotes.id, errorId), eq(errorNotes.userId, user.id))),
        db.insert(activities).values({ userId: user.id, type: "Erro excluído", topicId: existingError.topicId, topicName: existingError.topicName, subjectName: existingError.subjectName, createdAt: now() }),
      ]);
      return Response.json({ ok: true });
    }
    const summaryId = safeText(body.summaryId, 80);
    const topicId = safeText(body.topicId, 80);
    const topicName = safeText(body.topicName, 1200);
    const subjectName = safeText(body.subjectName, 120);
    if (!summaryId || !topicId) throw new AuthError(400, "Resumo inválido.");
    const [existing] = await db.select().from(summaries).where(and(eq(summaries.id, summaryId), eq(summaries.topicId, topicId), eq(summaries.userId, user.id))).limit(1);
    if (!existing) throw new AuthError(404, "Resumo não encontrado.");
    const [fallback] = await db.select().from(summaries).where(and(eq(summaries.userId, user.id), eq(summaries.topicId, topicId), sql`${summaries.id} <> ${summaryId}`)).orderBy(desc(summaries.updatedAt)).limit(1);
    const timestamp = now();
    await db.batch([
      db.delete(summaries).where(and(eq(summaries.id, summaryId), eq(summaries.userId, user.id))),
      db.delete(flashcards).where(and(eq(flashcards.userId, user.id), eq(flashcards.sourceSummaryId, summaryId))),
      db.insert(topicState).values({ userId: user.id, topicId, summaryHtml: fallback?.contentHtml || "", reviewText: fallback?.reviewText || "", updatedAt: timestamp }).onConflictDoUpdate({ target: [topicState.userId, topicState.topicId], set: { summaryHtml: fallback?.contentHtml || "", reviewText: fallback?.reviewText || "", updatedAt: timestamp } }),
      db.insert(activities).values({ userId: user.id, type: "Resumo excluído", topicId, topicName, subjectName, createdAt: timestamp }),
    ]);
    const imageIds = [...existing.contentHtml.matchAll(/data-summary-image=["']([0-9a-f-]{36})["']/gi)].map((match) => match[1]);
    if (imageIds.length) try { await deleteSummaryImages(imageIds); } catch { /* banco já atualizado */ }
    return Response.json({ ok: true, nextSummary: fallback || null });
  } catch (error) { return requestError(error); }
}
