#!/usr/bin/env node
// Ad-hoc SQL against the project, using the same transport logic as migrate.
//   npm run sql -- "select count(*) from items"
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, ".env.local");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const sql = process.argv.slice(2).join(" ");
if (!sql) { console.error('usage: npm run sql -- "select 1"'); process.exit(1); }

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const dir = mkdtempSync(join(tmpdir(), "kada-sql-"));
const bodyPath = join(dir, "body.json");
writeFileSync(bodyPath, JSON.stringify({ query: sql }));

const config = [
  `url = "https://api.supabase.com/v1/projects/${ref}/database/query"`,
  `request = "POST"`,
  `header = "Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN}"`,
  `header = "Content-Type: application/json"`,
  `data-binary = "@${bodyPath}"`,
  `silent`, `show-error`,
  `connect-timeout = 45`, `max-time = 120`,
  `retry = 4`, `retry-delay = 3`, `retry-all-errors`, `retry-max-time = 200`,
].join("\n");

try {
  const out = execFileSync("curl", ["-K", "-"], { input: config, encoding: "utf8", maxBuffer: 32e6 });
  try { console.log(JSON.stringify(JSON.parse(out), null, 1)); }
  catch { console.log(out); }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
