import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  status: text("status", { enum: ["PENDING", "ACTIVE", "BLOCKED"] }).notNull().default("ACTIVE"),
  emailVerifiedAt: text("email_verified_at"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  lastAccessAt: text("last_access_at"),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const userSessions = sqliteTable("user_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (table) => [
  uniqueIndex("user_sessions_token_unique").on(table.tokenHash),
  index("user_sessions_user_idx").on(table.userId),
]);

export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind", { enum: ["verify_email", "reset_password"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: text("created_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
}, (table) => [
  uniqueIndex("auth_tokens_token_unique").on(table.tokenHash),
  index("auth_tokens_user_kind_idx").on(table.userId, table.kind),
]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  windowStartedAt: text("window_started_at").notNull(),
  blockedUntil: text("blocked_until"),
});

export const topicState = sqliteTable("topic_state", {
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  summaryHtml: text("summary_html").notNull().default(""),
  reviewText: text("review_text").notNull().default(""),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  totalSeconds: integer("total_seconds").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.topicId] }),
  index("topic_state_user_idx").on(table.userId),
]);

export const summaries = sqliteTable("summaries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  title: text("title").notNull().default("Resumo"),
  contentHtml: text("content_html").notNull().default(""),
  reviewText: text("review_text").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("summaries_user_topic_idx").on(table.userId, table.topicId),
]);

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  topicId: text("topic_id").notNull(),
  topicName: text("topic_name").notNull(),
  subjectName: text("subject_name").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [index("activities_user_created_idx").on(table.userId, table.createdAt)]);

export const studyLogs = sqliteTable("study_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  seconds: integer("seconds").notNull(),
  studiedAt: text("studied_at").notNull(),
}, (table) => [index("study_logs_user_idx").on(table.userId)]);

export const errorNotes = sqliteTable("error_notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  subjectId: text("subject_id").notNull(),
  subjectName: text("subject_name").notNull(),
  topicName: text("topic_name").notNull(),
  priority: text("priority").notNull(),
  title: text("title").notNull().default("Erro registrado"),
  mistake: text("mistake").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("error_notes_user_updated_idx").on(table.userId, table.updatedAt),
  index("error_notes_user_topic_idx").on(table.userId, table.topicId),
]);

export const flashcards = sqliteTable("flashcards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull(),
  topicId: text("topic_id").notNull(),
  sourceSummaryId: text("source_summary_id"),
  sourceErrorId: text("source_error_id"),
  topicName: text("topic_name").notNull(),
  subjectName: text("subject_name").notNull(),
  priority: text("priority").notNull(),
  sourceReview: text("source_review").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  dueAt: text("due_at").notNull(),
  intervalDays: integer("interval_days").notNull().default(0),
  lastReviewedAt: text("last_reviewed_at"),
  createdAt: text("created_at").notNull(),
}, (table) => [
  index("flashcards_user_due_idx").on(table.userId, table.dueAt),
  index("flashcards_source_summary_idx").on(table.sourceSummaryId),
  index("flashcards_source_error_idx").on(table.sourceErrorId),
]);

export const studyScheduleSettings = sqliteTable("study_schedule_settings", {
  userId: text("user_id").notNull(),
  id: text("id").notNull(),
  availableDays: text("available_days").notNull().default("[]"),
  minutesPerDay: integer("minutes_per_day").notNull().default(180),
  includedSubjectIds: text("included_subject_ids").notNull().default("[]"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.id] })]);

export const studyScheduleBlocks = sqliteTable("study_schedule_blocks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  day: text("day").notNull(),
  subjectId: text("subject_id").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("study_schedule_user_day_position_idx").on(table.userId, table.day, table.position)]);
