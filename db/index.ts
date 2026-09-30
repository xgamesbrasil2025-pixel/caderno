import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

const dataDirectory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const databasePath = path.join(dataDirectory, "caderno-pmba.sqlite");

mkdirSync(dataDirectory, { recursive: true });

const client = createClient({ url: pathToFileURL(databasePath).href });
const database = drizzle(client, { schema });

await client.execute("PRAGMA journal_mode = WAL");
await client.execute("PRAGMA foreign_keys = ON");
await migrate(database, { migrationsFolder: path.join(process.cwd(), "drizzle") });

export function getDb() {
  return database;
}
