import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { summaries } from "@/db/schema";
import { AuthError, authErrorResponse, requireSameOrigin, requireUser } from "@/lib/auth";
import { deleteSummaryImage, readSummaryImage, saveSummaryImage } from "@/lib/image-storage";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function imageId(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  return IMAGE_ID.test(id) ? id : null;
}

async function canAccessImage(userId: string, id: string, ownerId?: string) {
  if (ownerId) return ownerId === userId;
  const db = await getDb();
  const [owner] = await db.select({ id: summaries.id }).from(summaries).where(and(
    eq(summaries.userId, userId),
    like(summaries.contentHtml, `%${id}%`),
  )).limit(1);
  return Boolean(owner);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const id = imageId(request);
    if (!id) throw new AuthError(400, "Imagem inválida.");
    const object = await readSummaryImage(id);
    if (!object || !(await canAccessImage(user.id, id, object.metadata.userId))) throw new AuthError(404, "Imagem não encontrada.");
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Type": object.metadata.contentType || "application/octet-stream",
        "ETag": object.etag,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json({ error: "Não foi possível carregar a imagem." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || !IMAGE_TYPES.has(file.type)) throw new AuthError(400, "Envie uma imagem JPG, PNG, WEBP, GIF ou AVIF.");
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new AuthError(400, "A imagem deve ter no máximo 8 MB.");
    const id = crypto.randomUUID();
    const topicId = String(form.get("topicId") || "").slice(0, 80);
    const summaryId = String(form.get("summaryId") || "").slice(0, 80);
    await saveSummaryImage(id, new Uint8Array(await file.arrayBuffer()), {
      userId: user.id,
      topicId,
      summaryId,
      contentType: file.type,
    });
    return Response.json({ id, url: `/api/summary-images?id=${encodeURIComponent(id)}` });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json({ error: "Não foi possível enviar a imagem agora." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const id = imageId(request);
    if (!id) throw new AuthError(400, "Imagem inválida.");
    const object = await readSummaryImage(id);
    if (!object || !(await canAccessImage(user.id, id, object.metadata.userId))) throw new AuthError(404, "Imagem não encontrada.");
    await deleteSummaryImage(id);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    return Response.json({ error: "Não foi possível excluir a imagem agora." }, { status: 503 });
  }
}
