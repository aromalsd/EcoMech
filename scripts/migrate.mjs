#!/usr/bin/env node
// Applies every SQL file in supabase/migrations in lexical order, once each.
// Reads SUPABASE_DB_URL from .env.local so no credential passes through a shell
// argument or process listing.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}

loadEnv();

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("SUPABASE_DB_URL is not set. Add it to .env.local:");
  console.error("  SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<host>:5432/postgres");
  process.exit(1);
}

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`create table if not exists _migrations (
  name text primary key, applied_at timestamptz not null default now())`);

const { rows } = await client.query("select name from _migrations");
const done = new Set(rows.map((r) => r.name));

let applied = 0;
for (const file of files) {
  if (done.has(file)) {
    console.log(`  skip  ${file}`);
    continue;
  }
  const sql = readFileSync(join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations (name) values ($1)", [file]);
    await client.query("commit");
    console.log(`  ok    ${file}`);
    applied++;
  } catch (err) {
    await client.query("rollback");
    console.error(`  FAIL  ${file}\n${err.message}`);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log(applied ? `\n${applied} migration(s) applied.` : "\nAlready up to date.");
