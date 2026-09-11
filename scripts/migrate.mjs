#!/usr/bin/env node
// Applies every SQL file in supabase/migrations in lexical order, exactly once.
//
// Two transports, chosen automatically (`--api` forces the second):
//   1. Postgres over SUPABASE_DB_URL — needs port 5432 or 6543 open
//   2. Supabase Management API over HTTPS — works where those are blocked
//
// The HTTPS path uses curl: it tolerates slow connects that exceed Node's
// fetch timeout, and config-on-stdin keeps the token out of the process list.

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = join(root, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const forceApi = process.argv.includes("--api");
const ref =
  process.env.SUPABASE_PROJECT_REF ||
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://x.supabase.co").hostname.split(".")[0];

function apiRunner(token) {
  const dir = mkdtempSync(join(tmpdir(), "kada-migrate-"));
  const bodyPath = join(dir, "body.json");
  const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;
  const config = [
    `url = "${url}"`,
    `request = "POST"`,
    `header = "Authorization: Bearer ${token}"`,
    `header = "Content-Type: application/json"`,
    `data-binary = "@${bodyPath}"`,
    `silent`,
    `show-error`,
    `connect-timeout = 45`,
    `max-time = 120`,
    `retry = 4`,
    `retry-delay = 3`,
    `retry-all-errors`,
    `retry-max-time = 200`,
    `write-out = "\\n%{http_code}"`,
  ].join("\n");

  return {
    async query(sql) {
      writeFileSync(bodyPath, JSON.stringify({ query: sql }));
      const out = execFileSync("curl", ["-K", "-"], {
        input: config,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      const split = out.lastIndexOf("\n");
      const status = Number(out.slice(split + 1).trim());
      const body = out.slice(0, split);
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}: ${body.slice(0, 800)}`);
      try {
        return JSON.parse(body);
      } catch {
        return [];
      }
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function directRunner(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000,
  });
  await client.connect();
  return {
    async query(sql) {
      const res = await client.query(sql);
      return res.rows ?? [];
    },
    close: () => client.end(),
  };
}

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.SUPABASE_DB_URL;
  let runner, transport;

  if (!forceApi && dbUrl) {
    try {
      runner = await directRunner(dbUrl);
      transport = "direct postgres";
    } catch (err) {
      if (!token) throw err;
      console.log(`  direct connection unavailable (${err.code ?? err.message}); using HTTPS`);
    }
  }

  if (!runner) {
    if (!token) {
      console.error(
        "No usable transport.\n\nEither open outbound Postgres to SUPABASE_DB_URL, or set\n" +
          "SUPABASE_ACCESS_TOKEN in .env.local from\n" +
          "https://supabase.com/dashboard/account/tokens",
      );
      process.exit(1);
    }
    runner = apiRunner(token);
    transport = `management API (project ${ref})`;
  }

  console.log(`transport: ${transport}\n`);

  await runner.query(`create table if not exists _migrations (
    name text primary key, applied_at timestamptz not null default now())`);

  const rows = await runner.query("select name from _migrations");
  const applied = new Set((rows ?? []).map((r) => r.name));

  const dir = join(root, "supabase", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    try {
      await runner.query(readFileSync(join(dir, file), "utf8"));
      await runner.query(
        `insert into _migrations (name) values (${lit(file)}) on conflict (name) do nothing`,
      );
      console.log(`  ok    ${file}`);
      count++;
    } catch (err) {
      console.error(`  FAIL  ${file}\n\n${err.message}\n`);
      runner.close();
      process.exit(1);
    }
  }

  runner.close();
  console.log(count ? `\n${count} migration(s) applied.` : "\nAlready up to date.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
