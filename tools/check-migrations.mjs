#!/usr/bin/env node
// Fail if two migration files share a numeric prefix.
//
// Supabase keys `supabase_migrations.schema_migrations` on the prefix alone —
// not the filename, not the contents. So if two branches each add a migration
// numbered 20260815000002, whichever one is pushed first claims the number, and
// `supabase db push` then reads the *other* file as already applied: it skips
// it and exits 0. The migration never runs and nothing reports a failure.
//
// That is not hypothetical. `20260815000002_aisle_memory.sql` and
// `20260815000002_status_sync_sweep_watermark.sql` were opened as concurrent
// PRs, the watermark landed in the ledger first, and `list_term_aisles` was
// missing from production for a day while every push reported success. The
// feature degrades to its own fallback on a failed read, so nothing surfaced.
//
// On a pull request GitHub checks out the merge commit, so both branches' files
// are in the tree here and the collision is visible before it can be applied.

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");

const FILENAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const problems = [];
const byVersion = new Map();

for (const file of files) {
  const match = FILENAME.exec(file);
  if (!match) {
    problems.push(`${file}: expected <14-digit version>_<lower_snake_name>.sql`);
    continue;
  }
  const [, version] = match;
  const seen = byVersion.get(version);
  if (seen) {
    problems.push(
      `${version} is claimed by two files:\n` +
        `    ${seen}\n` +
        `    ${file}\n` +
        `  Supabase keys the ledger on the version alone, so only one of these would ever\n` +
        `  be applied — and 'supabase db push' would report success either way.\n` +
        `  Renumber the newer one past every version already in the ledger.`,
    );
    continue;
  }
  byVersion.set(version, file);
}

if (problems.length > 0) {
  console.error("Migration check failed:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log(`Migration check passed: ${files.length} files, no duplicate versions.`);
