#!/usr/bin/env node
// Snippet-verification harness for the bilingual Supabase Deep Dive course.
//
// Unlike the astro/svelte/react/nextjs sibling courses (where the course IS
// the framework and a compiler check settles it), this course is about a
// PLATFORM: the only real proof is a real local Supabase stack (`supabase
// start`, real Postgres 17, real PostgREST/GoTrue/Realtime/Storage/Edge
// Runtime containers) plus real `psql`/`tsc`/`deno check`/`bash -n` against
// it. There is no in-browser SQL/RLS playground (spec §4.3) — this harness
// IS the playground's replacement.
//
// The quiz-array / `<SpotTheBug code={...}>` string-scanning exclusion
// technique (parseStringAt/scanBalanced/findExcludedRanges/stripExcluded)
// is ported VERBATIM from astro-deep-dive/tools/verify-snippets.mjs (itself
// ported from that course's tools/check-parity.mjs) — reused, not
// reinvented, per spec §5. Everything downstream of fence-collection (the
// probe lifecycle, the fence conventions, the execution model) is new: this
// course's fences are sql/ts/bash, not astro/ts, and "compiling" means a
// real transactional `psql` run / `tsc --noEmit` / `deno check` / `bash -n`,
// not a framework's own checker.
//
// Usage:
//   node tools/verify-snippets.mjs                  check every collected
//                                                    fence (sql via psql in
//                                                    a rolled-back tx per
//                                                    lesson, ts via tsc,
//                                                    edge-fn ts via deno
//                                                    check, bash via -n)
//   node tools/verify-snippets.mjs --refresh         stop+wipe+rescaffold
//                                                    tools/probe first
//   node tools/verify-snippets.mjs --strict          also fail on warnings
//   node tools/verify-snippets.mjs --all-sql         treat EVERY sql fence
//                                                    (path comment or not)
//                                                    as a migration, per
//                                                    lesson, rollback —
//                                                    honest baseline numbers
//                                                    against the current
//                                                    (no-path-comment) corpus
//   node tools/verify-snippets.mjs --apply <module>/<lesson>
//                                                    real COMMIT of one
//                                                    lesson's sql fences
//                                                    (migrations persisted
//                                                    to supabase/migrations
//                                                    for real, so `supabase
//                                                    db reset`/`start`
//                                                    replay them)
//   node tools/verify-snippets.mjs --run <module>/<lesson>
//                                                    tsx-execute that
//                                                    lesson's `// @run`
//                                                    ts fences against the
//                                                    live local stack
//   node tools/verify-snippets.mjs --reset           `supabase db reset`
//                                                    in the probe
//   node tools/verify-snippets.mjs --stop            `supabase stop` the
//                                                    probe's stack (do NOT
//                                                    run this on the shared
//                                                    stack other agents are
//                                                    reusing — see README)
//   node tools/verify-snippets.mjs --self-test       harness self-check
//
// Fence convention (spec §1/§5 — the current corpus has NO path comments
// yet; Phase 3/4 authors add them):
//   ```sql``` — first line `-- supabase/migrations/<name>.sql`, or
//               `-- supabase/seed.sql`, or `-- sql/<name>.sql` (an ad hoc
//               script, not a real migration file).
//   ```ts```  — first line `// src/<...>.ts` (checked with `tsc`, part of
//               one shared program) or `// supabase/functions/<name>/index.ts`
//               (a Deno edge function, checked standalone with `deno check`).
//   ```bash```— first line `# scripts/<name>.sh` (`bash -n` — syntax only,
//               never executed).
// A first line containing `@expect-error` (any comment style) is a
// deliberate-error demo: counted, never written to disk, never executed.
// Anything else is a fragment: counted, skipped.
//
// Namespacing: a collected fence is written to
// `tools/probe/lessons/<module>__<lesson>/<path-verbatim>` — e.g.
// `src/foo.ts` in lesson `client-development/typed-queries` lands at
// `tools/probe/lessons/client-development__typed-queries/src/foo.ts`. No
// specifier-rewriting is needed (unlike astro's sibling harness): this
// course's only documented cross-fence reference is a fixed one — a
// `src/<x>.ts` fence importing `import type { Database } from
// '../database.types'` — so the harness just copies the ONE shared,
// freshly-generated `tools/probe/database.types.ts` into every lesson
// namespace that has an `src/*.ts` fence, at exactly that relative position.
//
// SQL execution model: every collected sql fence in a lesson runs together,
// in document order, as ONE `psql -f -` invocation wrapped in
// `BEGIN; ...; ROLLBACK;` (default/--all-sql — proves syntax/semantics
// without persisting) or for real with no wrapper (--apply — a real COMMIT,
// migrations also persisted to the real `supabase/migrations/` so a later
// `supabase db reset` replays them). `-v ON_ERROR_STOP=1` means a lesson's
// sql fences after the first error are never reached in that run — same
// experience a human running the file through psql would get. Diagnostics
// are parsed from psql's own `psql:<stdin>:<line>: ERROR:  ...` format (real
// psql, run with `-f -` inside the running `supabase_db_<project_id>`
// container via `docker exec -i`, NOT a host-installed psql binary/brew
// install — see "Decisions" below) and mapped back to `<line>`'s fence via
// per-fence line ranges tracked while building the fed buffer.
//
// Decisions this harness made and is documenting per spec's own request:
//
// 1. No host `psql`, and brew is off-limits. The local stack's own Postgres
//    container (`supabase_db_<project_id>`, confirmed to bundle a real
//    `psql 17.6` matching the server) is used via `docker exec -i <container>
//    psql -U postgres -f -`, fed the fence buffer on stdin. This is the SAME
//    real psql, same diagnostic format (`psql:<stdin>:N: ERROR:`), zero new
//    host dependencies, and no cloud/brew involved.
// 2. Deno was not on the host (`which deno` → not found) either, and (per
//    the same brew ban) `brew install deno` was not an option. Rather than
//    fall back to a `supabase functions serve` HTTP smoke test (which only
//    proves a function *runs*, not that it *type-checks* — a materially
//    weaker guarantee for the edge-functions module's fences), this harness
//    installs the official `deno` npm package
//    (https://www.npmjs.com/package/deno, maintained by the Deno team) as a
//    devDependency of `tools/probe` alone: it's a ~11KB shim whose
//    postinstall downloads the real per-platform Deno binary. This needed
//    one extra step — npm's install-scripts allowlist blocks that
//    postinstall (and esbuild's, needed by `tsx`) by default — approved via
//    `npm install-scripts approve deno`/`esbuild` inside the probe only.
//    Confirmed working: `node_modules/.bin/deno check` on a real broken
//    file reports `TS2322 [ERROR]: ...` with `NO_COLOR=1` giving clean
//    (ANSI-free) output. Net effect: edge-function ts fences get a REAL
//    `deno check`, not a weaker smoke test, and nothing was installed
//    outside `tools/probe` (gitignored) or via brew.
// 3. Ports: the host already had an unrelated Supabase project's stack
//    running (`supabase_*_rw-fittrack2`, ports 54321-54324/54327) when this
//    harness was first scaffolded. `tools/probe/supabase/config.toml`'s
//    `port`/`shadow_port`/`inspector_port` values are bumped +1000 (54321 →
//    55321, etc. — the probe's `project_id` is `probe`, so container NAMES
//    never collided, only host ports did) so the two stacks coexist. If a
//    future host has no such conflict, these ports still work fine — they
//    just aren't the textbook 54321 default. `[db.pooler]` is also flipped
//    `enabled = true` (default `false`) so the production-and-ecosystem
//    pooler lesson can prove a real local pooler port (55329 here, given
//    the +1000 bump — not the cloud-only 6543 Supavisor convention).
//
// The probe's local stack is left RUNNING when this script exits (any mode
// except explicit `--stop`) — Phase 3/4 lesson-writing agents reuse it.
// Never run `--stop` on it as a side effect of anything other than a
// deliberate, explicit teardown.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PROBE_DIR = path.join(REPO_ROOT, 'tools/probe');
const LESSONS_DIR = path.join(PROBE_DIR, 'lessons');
const DOCS_EN = path.join(REPO_ROOT, 'src/content/docs/en');
const TSC_BIN = path.join(PROBE_DIR, 'node_modules/.bin/tsc');
const TSX_BIN = path.join(PROBE_DIR, 'node_modules/.bin/tsx');
const DENO_BIN = path.join(PROBE_DIR, 'node_modules/.bin/deno');

const FENCE_LANGS = new Set(['sql', 'ts', 'bash']);

// -- Fence path-comment conventions ------------------------------------------
const SQL_TOKEN = String.raw`supabase\/migrations\/[\w.-]+\.sql|supabase\/seed\.sql|sql\/[\w.-]+\.sql`;
const SQL_PATH_RE = new RegExp(`^-- (${SQL_TOKEN})(?:\\s+\\S.*)?$`);
const TS_TOKEN = String.raw`src\/[\w@.\-/[\]()]+\.ts|supabase\/functions\/[\w.-]+\/index\.ts`;
const TS_PATH_RE = new RegExp(`^\\/\\/ (${TS_TOKEN})(?:\\s+\\S.*)?$`);
const BASH_TOKEN = String.raw`scripts\/[\w.-]+\.sh`;
const BASH_PATH_RE = new RegExp(`^# (${BASH_TOKEN})(?:\\s+\\S.*)?$`);

// ---------------------------------------------------------------------------
// String/bracket scanning helpers — ported VERBATIM from
// astro-deep-dive/tools/verify-snippets.mjs (itself ported from that
// course's tools/check-parity.mjs). Keeps quiz-array template literals and
// `<SpotTheBug code={\`...\`}>` props from confusing the fence regex, once
// this course's own Quiz/SpotTheBug port lands (spec §0/§3.5) — reused
// up front so the harness doesn't need touching when that port lands.
// ---------------------------------------------------------------------------

function parseStringAt(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      j++;
      break;
    }
    j++;
  }
  return { end: j };
}

function scanBalanced(text, start, open, close) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = parseStringAt(text, i).end;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  return i;
}

function findExcludedRanges(src) {
  const ranges = [];
  {
    const re = /export\s+const\s+\w+\s*=\s*\[/g;
    let m;
    while ((m = re.exec(src))) {
      const end = scanBalanced(src, re.lastIndex, '[', ']');
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  {
    const re = /<SpotTheBug\s+code=\{\s*`/g;
    let m;
    while ((m = re.exec(src))) {
      const backtickIdx = m.index + m[0].length - 1;
      const { end } = parseStringAt(src, backtickIdx);
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  return ranges;
}

function stripExcluded(src, ranges) {
  if (!ranges.length) return src;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out += src.slice(cursor, start);
    out += src.slice(start, end).replace(/[^\n]/g, '');
    cursor = end;
  }
  out += src.slice(cursor);
  return out;
}

function countNewlinesBefore(s, upto) {
  let n = 0;
  for (let i = 0; i < upto; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Fence collection
// ---------------------------------------------------------------------------

// fenceNum is 1-based over EVERY real fence (any language) in document
// order, matching what a reader sees as "the Nth code block on the
// rendered page" — same semantics as the astro sibling harness.
function collectFences(rawSrc, { allSql = false } = {}) {
  const src = stripExcluded(rawSrc, findExcludedRanges(rawSrc));
  const fenceRe = /```(\w*)[^\n]*\n([\s\S]*?)```/g;
  const results = [];
  let fenceNum = 0;
  let m;
  while ((m = fenceRe.exec(src))) {
    fenceNum++;
    const lang = m[1];
    if (!FENCE_LANGS.has(lang)) continue;
    const body = m[2];
    const line = countNewlinesBefore(src, m.index) + 1;
    const firstLine = body.split('\n')[0].trim();

    if (firstLine.includes('@expect-error')) {
      results.push({ fenceNum, lang, line, category: 'expect-error' });
      continue;
    }

    if (lang === 'sql') {
      const pm = SQL_PATH_RE.exec(firstLine);
      if (pm) {
        results.push({ fenceNum, lang, line, category: 'collected', kind: 'sql', path: pm[1], body });
      } else if (allSql) {
        // --all-sql: no path comment yet (current corpus baseline) — still
        // collect it as a migration-in-document-order fence, under a
        // synthetic path (never a real supabase/migrations name, so it
        // can't collide with a real one a lesson does carry).
        results.push({
          fenceNum,
          lang,
          line,
          category: 'collected',
          kind: 'sql',
          path: `sql/fence-${fenceNum}.sql`,
          body,
          synthetic: true,
        });
      } else {
        results.push({ fenceNum, lang, line, category: 'skipped-no-path' });
      }
      continue;
    }

    if (lang === 'ts') {
      const pm = TS_PATH_RE.exec(firstLine);
      if (pm) {
        const p = pm[1];
        const kind = p.startsWith('supabase/functions/') ? 'ts-edge' : 'ts-lib';
        results.push({ fenceNum, lang, line, category: 'collected', kind, path: p, body });
      } else {
        results.push({ fenceNum, lang, line, category: 'skipped-no-path' });
      }
      continue;
    }

    // bash
    const pm = BASH_PATH_RE.exec(firstLine);
    if (pm) {
      results.push({ fenceNum, lang, line, category: 'collected', kind: 'bash', path: pm[1], body });
    } else {
      results.push({ fenceNum, lang, line, category: 'skipped-no-path' });
    }
  }
  return results;
}

function destRelPath(ns, srcPath) {
  return path.posix.join('lessons', ns, srcPath);
}

// ---------------------------------------------------------------------------
// Probe lifecycle
// ---------------------------------------------------------------------------

const PROBE_PACKAGE_JSON = `{
  "name": "supabase-deep-dive-probe",
  "private": true,
  "type": "module",
  "description": "Harness-owned probe for tools/verify-snippets.mjs. Not part of the site build. Regenerated by the harness; safe to delete (tools/probe/ is gitignored).",
  "devDependencies": {}
}
`;

function npmViewVersion(pkg) {
  const res = spawnSync('npm', ['view', pkg, 'version'], { encoding: 'utf8' });
  const v = (res.stdout ?? '').trim();
  return v || 'latest';
}

function ensureSupabaseInit() {
  if (existsSync(path.join(PROBE_DIR, 'supabase/config.toml'))) return;
  const res = spawnSync('supabase', ['init', '--workdir', PROBE_DIR], { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error('supabase init failed');
    process.exit(1);
  }
}

// See "Decisions" §3 in the file header: bump every local-stack port +1000
// (idempotent — a no-op once already bumped) so this probe coexists with
// whatever else is already running on the host.
function bumpConfigPorts() {
  const p = path.join(PROBE_DIR, 'supabase/config.toml');
  const cfg = readFileSync(p, 'utf8');
  const next = cfg.replace(/^(port|shadow_port|inspector_port) = 543(\d{2})$/gm, '$1 = 553$2');
  if (next !== cfg) writeFileSync(p, next);
}

// Flip ONLY [db.pooler]'s own `enabled = false` to `true` (idempotent) —
// see "Decisions" §3. Section-scoped so no other `enabled = false` in the
// file is touched.
function enablePooler() {
  const p = path.join(PROBE_DIR, 'supabase/config.toml');
  const cfg = readFileSync(p, 'utf8');
  const secStart = cfg.indexOf('[db.pooler]');
  if (secStart === -1) return;
  const secEnd = cfg.indexOf('\n[', secStart + 1);
  const end = secEnd === -1 ? cfg.length : secEnd;
  const section = cfg.slice(secStart, end);
  const patched = section.replace('enabled = false', 'enabled = true');
  if (patched !== section) writeFileSync(p, cfg.slice(0, secStart) + patched + cfg.slice(end));
}

function getProjectId() {
  const cfg = readFileSync(path.join(PROBE_DIR, 'supabase/config.toml'), 'utf8');
  const m = /^project_id\s*=\s*"([^"]+)"/m.exec(cfg);
  return m ? m[1] : 'probe';
}

function dbContainerName() {
  return `supabase_db_${getProjectId()}`;
}

// Generated, harness-owned tsconfig for the `lessons/` tree. Only
// `lessons/*/src/**/*.ts` fences are compiled this way — a lesson's
// `supabase/functions/<name>/index.ts` fence lives under a different branch
// entirely (`lessons/<ns>/supabase/functions/...`) and is never matched by
// this include glob, so it needs no `exclude` — it's simply checked
// separately, per-file, with `deno check` instead (see checkMode).
const TSCONFIG_SRC = {
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    esModuleInterop: true,
    noEmit: true,
    skipLibCheck: true,
  },
  include: ['lessons/*/src/**/*.ts'],
};

function writeTsconfig() {
  writeFileSync(path.join(PROBE_DIR, 'tsconfig.json'), `${JSON.stringify(TSCONFIG_SRC, null, 2)}\n`);
}

function isStackUp() {
  const res = spawnSync('supabase', ['status', '--workdir', PROBE_DIR], { encoding: 'utf8' });
  return res.status === 0;
}

function stopStackQuiet() {
  spawnSync('supabase', ['stop', '--workdir', PROBE_DIR], { stdio: 'ignore' });
}

function genDatabaseTypes() {
  const res = spawnSync('supabase', ['gen', 'types', 'typescript', '--local', '--workdir', PROBE_DIR], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    console.error('supabase gen types typescript --local failed:', res.stderr);
    return;
  }
  writeFileSync(path.join(PROBE_DIR, 'database.types.ts'), res.stdout);
}

function ensureProbe(refresh) {
  if (refresh && existsSync(PROBE_DIR)) {
    stopStackQuiet();
    rmSync(PROBE_DIR, { recursive: true, force: true });
  }

  const firstScaffold = !existsSync(PROBE_DIR);
  if (firstScaffold) {
    console.log('tools/probe missing — scaffolding (npm project + supabase init)...');
    mkdirSync(PROBE_DIR, { recursive: true });
    writeFileSync(path.join(PROBE_DIR, 'package.json'), PROBE_PACKAGE_JSON);

    // "current 2.x" etc — resolved from the registry once, at scaffold time
    // only (spec §5), not re-resolved on every run.
    const supabaseJs = npmViewVersion('@supabase/supabase-js');
    const typescript = npmViewVersion('typescript');
    const tsx = npmViewVersion('tsx');
    const deno = npmViewVersion('deno');
    console.log(`resolved versions: @supabase/supabase-js@${supabaseJs} typescript@${typescript} tsx@${tsx} deno@${deno}`);

    const install = spawnSync(
      'npm',
      ['install', '-D', `@supabase/supabase-js@${supabaseJs}`, `typescript@${typescript}`, `tsx@${tsx}`, `deno@${deno}`],
      { cwd: PROBE_DIR, stdio: 'inherit' },
    );
    if (install.status !== 0) {
      console.error('probe npm install failed');
      process.exit(1);
    }
    // deno's (and tsx's esbuild) postinstall fetches the real binary —
    // blocked by npm's install-scripts allowlist by default. Approved here,
    // scoped to this one gitignored probe project only (see Decisions §2).
    for (const pkg of ['deno', 'esbuild']) {
      spawnSync('npm', ['install-scripts', 'approve', pkg], { cwd: PROBE_DIR, stdio: 'inherit' });
    }
    if (!existsSync(DENO_BIN)) {
      console.error(`expected ${DENO_BIN} after npm install — deno postinstall likely did not run`);
      process.exit(1);
    }
  }

  ensureSupabaseInit();
  bumpConfigPorts();
  enablePooler();
  writeTsconfig();

  if (!isStackUp()) {
    console.log('probe supabase stack not running — starting (`supabase start`)...');
    const start = spawnSync('supabase', ['start', '--workdir', PROBE_DIR], { stdio: 'inherit' });
    if (start.status !== 0) {
      console.error('supabase start failed');
      process.exit(1);
    }
  } else {
    console.log('probe supabase stack already running — reusing.');
  }

  genDatabaseTypes();
}

function getStatusEnv() {
  const res = spawnSync('supabase', ['status', '-o', 'env', '--workdir', PROBE_DIR], { encoding: 'utf8' });
  const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  const env = {};
  const re = /^([A-Z0-9_]+)="(.*)"$/gm;
  let m;
  while ((m = re.exec(text))) env[m[1]] = m[2];
  return env;
}

// ---------------------------------------------------------------------------
// Lesson discovery
// ---------------------------------------------------------------------------

function discoverLessons() {
  const rels = globSync('**/*.mdx', { cwd: DOCS_EN }).sort();
  return rels.map((rel) => {
    const posixRel = rel.replaceAll('\\', '/');
    return {
      absPath: path.join(DOCS_EN, rel),
      mdxRelPath: `src/content/docs/en/${posixRel}`,
      module: posixRel.split('/')[0],
      lesson: path.basename(posixRel, '.mdx'),
    };
  });
}

function splitTarget(target) {
  if (!target) {
    console.error('usage: <module>/<lesson> required');
    process.exit(1);
  }
  const parts = target.split('/');
  const lesson = parts.pop();
  const module = parts.join('/');
  return { module, lesson };
}

function findLessonMdx(module, lesson) {
  const abs = path.join(DOCS_EN, module, `${lesson}.mdx`);
  if (!existsSync(abs)) {
    console.error(`lesson not found: ${abs}`);
    process.exit(1);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Build the probe's lessons/ tree from a set of lesson descriptors
// ---------------------------------------------------------------------------

function buildLessonsTree(descriptors, { allSql = false } = {}) {
  rmSync(LESSONS_DIR, { recursive: true, force: true });
  mkdirSync(LESSONS_DIR, { recursive: true });

  const byNs = new Map(); // ns -> { mdxRelPath, module, lesson, fences: [collected...] }
  const stats = new Map(); // module -> { sql, ts, bash, skipped, expectError }

  for (const d of descriptors) {
    const ns = `${d.module}__${d.lesson}`;
    const src = readFileSync(d.absPath, 'utf8');
    const counters = stats.get(d.module) ?? { sql: 0, ts: 0, bash: 0, skipped: 0, expectError: 0 };
    stats.set(d.module, counters);

    const collected = [];
    for (const f of collectFences(src, { allSql })) {
      if (f.category === 'collected') {
        counters[f.lang] = (counters[f.lang] ?? 0) + 1;
        collected.push(f);
      } else if (f.category === 'skipped-no-path') {
        counters.skipped++;
      } else if (f.category === 'expect-error') {
        counters.expectError++;
      }
    }
    byNs.set(ns, { mdxRelPath: d.mdxRelPath, module: d.module, lesson: d.lesson, fences: collected });
  }

  const typesSrc = path.join(PROBE_DIR, 'database.types.ts');
  const typesAvailable = existsSync(typesSrc);
  const typesBody = typesAvailable ? readFileSync(typesSrc, 'utf8') : null;

  for (const [ns, info] of byNs) {
    for (const f of info.fences) {
      const dest = path.join(PROBE_DIR, destRelPath(ns, f.path));
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, f.body);
    }
    if (typesBody && info.fences.some((f) => f.kind === 'ts-lib')) {
      writeFileSync(path.join(PROBE_DIR, 'lessons', ns, 'database.types.ts'), typesBody);
    }
  }

  return { byNs, stats };
}

// ---------------------------------------------------------------------------
// SQL execution: one lesson's collected sql fences, one psql -f - run
// ---------------------------------------------------------------------------

function buildSqlBuffer(fences, { commit = false } = {}) {
  const outLines = commit ? [] : ['BEGIN;'];
  const ranges = [];
  for (const f of fences) {
    const startLine = outLines.length + 1;
    const bodyLines = f.body.replace(/\n$/, '').split('\n');
    outLines.push(...bodyLines);
    ranges.push({ fenceNum: f.fenceNum, path: f.path, startLine, endLine: outLines.length });
  }
  if (!commit) outLines.push('ROLLBACK;');
  return { buffer: `${outLines.join('\n')}\n`, ranges };
}

function runPsql(sqlText) {
  return spawnSync('docker', ['exec', '-i', dbContainerName(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: sqlText,
    encoding: 'utf8',
  });
}

const PSQL_ERR_RE = /psql:<stdin>:(\d+): ERROR:/;

function parsePsqlError(stderr) {
  const text = stderr ?? '';
  const m = PSQL_ERR_RE.exec(text);
  if (!m) return null;
  return { line: Number(m[1]), block: text.slice(m.index).trim() };
}

function findRange(ranges, line) {
  return ranges.find((r) => line >= r.startLine && line <= r.endLine);
}

// ---------------------------------------------------------------------------
// tsc: one shared program over every lesson's src/*.ts fences
// ---------------------------------------------------------------------------

const TSC_DIAG_RE = /^(.+?)\((\d+),(\d+)\): (error|warning) TS(\d+): (.+)$/gm;

function runTsc() {
  const res = spawnSync(TSC_BIN, ['-p', 'tsconfig.json'], { cwd: PROBE_DIR, encoding: 'utf8' });
  const out = res.stdout ?? '';
  const diagnostics = [];
  let m;
  while ((m = TSC_DIAG_RE.exec(out))) {
    const [, file, line, col, severity, code, message] = m;
    const norm = file.replaceAll('\\', '/');
    const lm = /^lessons\/([^/]+)\/(.+)$/.exec(norm);
    diagnostics.push({ severity, ns: lm?.[1], relPath: lm?.[2], line, col, code, message });
  }
  if (res.status !== 0 && !diagnostics.length && out.trim()) {
    diagnostics.push({ severity: 'error', ns: null, relPath: null, line: null, col: null, code: null, message: out.trim() });
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// Check mode (default / --all-sql)
// ---------------------------------------------------------------------------

function checkMode(descriptors, { allSql = false, strict = false } = {}) {
  const { byNs, stats } = buildLessonsTree(descriptors, { allSql });
  const diagnostics = [];

  // SQL: one psql run per lesson, in document order, wrapped in BEGIN/ROLLBACK.
  for (const [ns, info] of byNs) {
    const sqlFences = info.fences.filter((f) => f.kind === 'sql');
    if (!sqlFences.length) continue;
    const { buffer, ranges } = buildSqlBuffer(sqlFences);
    if (process.env.DEBUG_SQL_BUFFER) {
      console.error(`--- sql buffer for ${ns} ---\n${buffer}\n--- ranges ---`, ranges);
    }
    const res = runPsql(buffer);
    const err = parsePsqlError(res.stderr);
    if (err) {
      const range = findRange(ranges, err.line);
      info.sqlResult = { total: sqlFences.length, pass: false, failedFenceNum: range?.fenceNum };
      diagnostics.push({
        severity: 'error',
        kind: 'sql',
        mdxRelPath: info.mdxRelPath,
        fenceNum: range?.fenceNum,
        message: err.block,
      });
    } else if (res.status !== 0) {
      info.sqlResult = { total: sqlFences.length, pass: false, failedFenceNum: null };
      diagnostics.push({
        severity: 'error',
        kind: 'sql',
        mdxRelPath: info.mdxRelPath,
        fenceNum: null,
        message: (res.stderr || res.stdout || 'psql exited non-zero with no parseable ERROR line').trim(),
      });
    } else {
      info.sqlResult = { total: sqlFences.length, pass: true };
    }
  }

  // ts-lib: one tsc program over everything at once — but only if at least
  // one lesson actually has an src/*.ts fence, or tsc's own "no inputs
  // found in config file" (TS18003) becomes a spurious failure on a corpus
  // with zero collected ts fences (the current baseline, see README).
  const anyTsLib = [...byNs.values()].some((info) => info.fences.some((f) => f.kind === 'ts-lib'));
  for (const d of anyTsLib ? runTsc() : []) {
    const info = d.ns ? byNs.get(d.ns) : null;
    const fenceNum = info?.fences.find((f) => f.path === d.relPath)?.fenceNum;
    diagnostics.push({
      severity: d.severity,
      kind: 'ts',
      mdxRelPath: info?.mdxRelPath ?? '[unmapped]',
      fenceNum,
      message: d.code ? `TS${d.code} (${d.line}:${d.col}): ${d.message}` : d.message,
    });
  }

  // ts-edge: deno check, one file at a time (own module graph, own globals).
  for (const [ns, info] of byNs) {
    for (const f of info.fences.filter((x) => x.kind === 'ts-edge')) {
      const dest = path.join(PROBE_DIR, destRelPath(ns, f.path));
      const dres = spawnSync(DENO_BIN, ['check', dest], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      if (dres.status !== 0) {
        diagnostics.push({
          severity: 'error',
          kind: 'deno',
          mdxRelPath: info.mdxRelPath,
          fenceNum: f.fenceNum,
          message: (dres.stderr || dres.stdout || 'deno check exited non-zero').trim(),
        });
      }
    }
  }

  // bash: `bash -n`, one file at a time — syntax only, never executed.
  for (const [ns, info] of byNs) {
    for (const f of info.fences.filter((x) => x.kind === 'bash')) {
      const dest = path.join(PROBE_DIR, destRelPath(ns, f.path));
      const bres = spawnSync('bash', ['-n', dest], { encoding: 'utf8' });
      if (bres.status !== 0) {
        diagnostics.push({
          severity: 'error',
          kind: 'bash',
          mdxRelPath: info.mdxRelPath,
          fenceNum: f.fenceNum,
          message: (bres.stderr || 'bash -n exited non-zero').trim(),
        });
      }
    }
  }

  printDiagnostics(diagnostics);
  printStats(stats);
  if (allSql) printAllSqlSummary(byNs);

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  const fail = errors.length > 0 || (strict && warnings.length > 0);
  return { fail, errorCount: errors.length, warningCount: warnings.length, diagnostics, stats, byNs };
}

function printDiagnostics(diagnostics) {
  if (!diagnostics.length) {
    console.log('\nno errors, no warnings.');
    return;
  }
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity !== 'error');
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s):\n`);
  for (const d of diagnostics) {
    const where = d.fenceNum ? `${d.mdxRelPath}:fence #${d.fenceNum}` : `${d.mdxRelPath} [unmapped]`;
    console.log(`${d.severity} [${d.kind}] ${where}\n  ${d.message.split('\n').join('\n  ')}`);
  }
}

function printStats(stats) {
  console.log('\nPer-module fence summary (sql / ts / bash collected — skipped-no-path — expect-error):');
  const totals = { sql: 0, ts: 0, bash: 0, skipped: 0, expectError: 0 };
  for (const [module, c] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${module}: ${c.sql} / ${c.ts} / ${c.bash} — ${c.skipped} — ${c.expectError}`);
    for (const k of Object.keys(totals)) totals[k] += c[k];
  }
  console.log(`  TOTAL: ${totals.sql} / ${totals.ts} / ${totals.bash} — ${totals.skipped} — ${totals.expectError}`);
}

function printAllSqlSummary(byNs) {
  console.log('\n--all-sql per-lesson results (fragments referencing another lesson\'s tables are EXPECTED to fail):');
  let passCount = 0;
  let failCount = 0;
  let totalFences = 0;
  for (const [, info] of [...byNs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sqlFences = info.fences.filter((f) => f.kind === 'sql');
    if (!sqlFences.length) continue;
    totalFences += sqlFences.length;
    const r = info.sqlResult;
    const label = `${info.module}/${info.lesson}`;
    if (r?.pass) {
      passCount++;
      console.log(`  PASS ${label} (${sqlFences.length} sql fence(s))`);
    } else {
      failCount++;
      const at = r?.failedFenceNum ? `, failed at fence #${r.failedFenceNum}` : '';
      console.log(`  FAIL ${label} (${sqlFences.length} sql fence(s))${at}`);
    }
  }
  console.log(`  TOTAL: ${passCount} lesson(s) passed, ${failCount} lesson(s) failed, ${totalFences} sql fence(s) considered.`);
}

// ---------------------------------------------------------------------------
// --apply <module>/<lesson>: real COMMIT, migrations persisted for real
// ---------------------------------------------------------------------------

function applyMode(target) {
  const { module, lesson } = splitTarget(target);
  const mdxAbs = findLessonMdx(module, lesson);
  const fences = collectFences(readFileSync(mdxAbs, 'utf8')).filter((f) => f.category === 'collected' && f.kind === 'sql');
  if (!fences.length) {
    console.log(`${target}: no collected sql fences to apply`);
    process.exit(0);
  }

  for (const f of fences) {
    if (f.path.startsWith('supabase/migrations/') || f.path === 'supabase/seed.sql') {
      const real = path.join(PROBE_DIR, f.path);
      mkdirSync(path.dirname(real), { recursive: true });
      writeFileSync(real, f.body);
      console.log(`persisted ${f.path} (fence #${f.fenceNum}) for real — future \`supabase db reset\` replays it`);
    }
  }

  const { buffer } = buildSqlBuffer(fences, { commit: true });
  const res = runPsql(buffer);
  process.stdout.write(res.stdout ?? '');
  process.stderr.write(res.stderr ?? '');
  const err = parsePsqlError(res.stderr);
  if (err) console.error(`\nFAILED at psql:<stdin>:${err.line} — check which fence that line falls in above`);
  process.exit(res.status ?? 1);
}

// ---------------------------------------------------------------------------
// --run <module>/<lesson>: tsx-execute `// @run` ts fences against the
// live stack
// ---------------------------------------------------------------------------

function runMode(target) {
  const { module, lesson } = splitTarget(target);
  const mdxAbs = findLessonMdx(module, lesson);
  const ns = `${module}__${lesson}`;
  const src = readFileSync(mdxAbs, 'utf8');
  const fences = collectFences(src).filter((f) => f.category === 'collected' && f.kind === 'ts-lib');
  const runnable = fences.filter((f) => (f.body.split('\n')[1] ?? '').trim() === '// @run');
  if (!runnable.length) {
    console.log(`${target}: no ts fence with \`// @run\` on line 2`);
    process.exit(0);
  }

  buildLessonsTree(discoverLessons());

  const statusEnv = getStatusEnv();
  const runtimeEnv = {
    ...process.env,
    SUPABASE_URL: statusEnv.API_URL,
    SUPABASE_ANON_KEY: statusEnv.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: statusEnv.SERVICE_ROLE_KEY,
  };

  let failed = false;
  for (const f of runnable) {
    const dest = path.join(PROBE_DIR, destRelPath(ns, f.path));
    console.log(`\n--- tsx ${f.path} (fence #${f.fenceNum}) ---`);
    const res = spawnSync(TSX_BIN, [dest], { cwd: PROBE_DIR, env: runtimeEnv, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim();
    console.log(out.split('\n').slice(-40).join('\n'));
    const timedOut = res.signal === 'SIGKILL' && res.status === null;
    console.log(`exit=${timedOut ? 'TIMEOUT (60s)' : res.status}`);
    if (timedOut || res.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

function resetMode() {
  const res = spawnSync('supabase', ['db', 'reset', '--workdir', PROBE_DIR], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

function stopMode() {
  const res = spawnSync('supabase', ['stop', '--workdir', PROBE_DIR], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

// Fence numbers below are 1-based over ALL fences in SELFTEST_MDX, in
// document order — kept in sync with the literal content by hand (5 fences
// total, no other languages present, so fenceNum === position here).
const GOOD_MIGRATION_FENCE = 1;
const BAD_MIGRATION_FENCE = 2;
// fence 3 is the @expect-error fence (never executed, never numbered here).
const TS_FENCE = 4;
const BASH_FENCE = 5;

const SELFTEST_MDX = `---
title: selftest
---

Self-test fixture for tools/verify-snippets.mjs — not a real lesson.

\`\`\`sql
-- supabase/migrations/0001_selftest_good.sql
create table selftest_items (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid(),
  name text not null
);
alter table selftest_items enable row level security;
create policy "owner can select" on selftest_items
  for select using (auth.uid() = owner);
\`\`\`

\`\`\`sql
-- supabase/migrations/0002_selftest_bad.sql
create table this is not valid syntax;
\`\`\`

\`\`\`sql
-- @expect-error deliberately violates the NOT NULL constraint above
insert into selftest_items (name) values (null);
\`\`\`

\`\`\`ts
// src/selftest-client.ts
import { createClient } from '@supabase/supabase-js';

// Self-contained Database stub (not the real generated one — this fence's
// own migration above never actually commits, by design, in --check mode;
// see checkMode's SQL model). Proves the createClient<Database>() + real
// typed .select() mechanism the spec's self-test asks for, independent of
// live schema/rollback timing.
interface Database {
  public: {
    Tables: {
      selftest_items: {
        Row: { id: string; name: string };
        Insert: { id?: string; name: string };
        Update: { id?: string; name?: string };
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

const supabase = createClient<Database>('http://127.0.0.1:0', 'anon-key-placeholder');

export async function loadItems() {
  const { data, error } = await supabase.from('selftest_items').select('id, name');
  if (error) throw error;
  return data;
}
\`\`\`

\`\`\`bash
# scripts/selftest.sh
#!/usr/bin/env bash
set -euo pipefail
echo "selftest ok"
\`\`\`
`;

function selfTest() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'verify-snippets-selftest-'));
  const mdxPath = path.join(tmpDir, 'self.mdx');
  writeFileSync(mdxPath, SELFTEST_MDX);
  const descriptors = [{ absPath: mdxPath, mdxRelPath: 'selftest/self.mdx', module: '__selftest__', lesson: 'self' }];

  const { diagnostics, stats } = checkMode(descriptors, {});

  const sqlDiag = diagnostics.find((d) => d.kind === 'sql' && d.mdxRelPath === 'selftest/self.mdx');
  const badMapped = sqlDiag?.fenceNum === BAD_MIGRATION_FENCE;
  const goodNotFlagged = !diagnostics.some((d) => d.kind === 'sql' && d.fenceNum === GOOD_MIGRATION_FENCE);
  const tsClean = !diagnostics.some((d) => d.kind === 'ts' && d.mdxRelPath === 'selftest/self.mdx' && d.fenceNum === TS_FENCE);
  const bashClean = !diagnostics.some((d) => d.kind === 'bash' && d.mdxRelPath === 'selftest/self.mdx' && d.fenceNum === BASH_FENCE);
  const expectErrorCounted = (stats.get('__selftest__')?.expectError ?? 0) === 1;

  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(LESSONS_DIR, { recursive: true, force: true });

  const detail = { badMapped, goodNotFlagged, tsClean, bashClean, expectErrorCounted };
  const ok = Object.values(detail).every(Boolean);
  if (ok) {
    console.log('\nself-test: PASS', detail);
    process.exit(0);
  }
  console.error('\nself-test: FAIL', detail);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--stop')) return stopMode();

  ensureProbe(args.includes('--refresh'));

  if (args.includes('--self-test')) return selfTest();
  if (args.includes('--reset')) return resetMode();

  const applyIdx = args.indexOf('--apply');
  if (applyIdx !== -1) return applyMode(args[applyIdx + 1]);

  const runIdx = args.indexOf('--run');
  if (runIdx !== -1) return runMode(args[runIdx + 1]);

  const allSql = args.includes('--all-sql');
  const strict = args.includes('--strict');
  const { fail } = checkMode(discoverLessons(), { allSql, strict });
  process.exit(fail ? 1 : 0);
}

main();
