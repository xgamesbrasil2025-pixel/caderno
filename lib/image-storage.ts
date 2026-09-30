import "server-only";

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

type StoredImageMetadata = {
  userId: string;
  topicId: string;
  summaryId: string;
  contentType: string;
};

const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const imageDirectory = path.join(dataDirectory, "summary-images");

function imageFile(id: string) {
  return path.join(imageDirectory, `${id}.bin`);
}

function metadataFile(id: string) {
  return path.join(imageDirectory, `${id}.json`);
}

export async function saveSummaryImage(id: string, bytes: Uint8Array, metadata: StoredImageMetadata) {
  await mkdir(imageDirectory, { recursive: true });
  await Promise.all([
    writeFile(imageFile(id), bytes),
    writeFile(metadataFile(id), JSON.stringify(metadata), "utf8"),
  ]);
}

export async function readSummaryImage(id: string) {
  try {
    const [body, metadataText, details] = await Promise.all([
      readFile(imageFile(id)),
      readFile(metadataFile(id), "utf8"),
      stat(imageFile(id)),
    ]);
    return {
      body,
      metadata: JSON.parse(metadataText) as StoredImageMetadata,
      etag: `W/\"${details.size}-${Math.round(details.mtimeMs)}\"`,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function deleteSummaryImage(id: string) {
  await Promise.all([
    rm(imageFile(id), { force: true }),
    rm(metadataFile(id), { force: true }),
  ]);
}

export async function deleteSummaryImages(ids: string[]) {
  await Promise.all(ids.map((id) => deleteSummaryImage(id)));
}
