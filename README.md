# Supabase — From Zero to Hero

Bilingual (EN/TH) Starlight course covering Supabase: the auto-generated
Data API, Auth/RLS, Realtime, Storage, Edge Functions, client development,
and production concerns.

## Harness

`tools/verify-snippets.mjs` proves lesson code snippets actually work
against a **real local Supabase stack** (`supabase start` — real Postgres
17, PostgREST, GoTrue, Realtime, Storage, Edge Runtime) — there is no
in-browser SQL/RLS playground for this course (unlike the sibling
astro/svelte/react deep-dive courses' compiler-only playgrounds); the
harness itself is the only proof mechanism.

```sh
npm run verify                                  # check every collected fence (0 collected today — see "Baseline" below)
node tools/verify-snippets.mjs --refresh        # stop + wipe + rescaffold tools/probe first
node tools/verify-snippets.mjs --strict         # also fail on warnings
node tools/verify-snippets.mjs --all-sql        # every sql fence, path comment or not — honest baseline numbers
node tools/verify-snippets.mjs --apply <module>/<lesson>   # real COMMIT of one lesson's sql fences
node tools/verify-snippets.mjs --run <module>/<lesson>     # tsx-execute that lesson's `// @run` ts fences live
node tools/verify-snippets.mjs --reset          # `supabase db reset` in the probe
node tools/verify-snippets.mjs --stop           # stop the probe's stack (see "Do not stop the shared stack" below)
node tools/verify-snippets.mjs --self-test      # harness self-check
```

### Fence convention

The current corpus has **no path-comment fences yet** — Phase 1+2 wrote
plain fragments. Phase 3/4 lesson authors add the path comment below to
make a fence real and checkable; everything else stays a documentation
fragment and is silently skipped (counted, not run).

- `` ```sql `` — first line `-- supabase/migrations/<name>.sql` (a real,
  ordered migration), or `-- supabase/seed.sql`, or `-- sql/<name>.sql` (an
  ad hoc script — not a migration). Every collected sql fence in one lesson
  runs together, in document order, as one `psql -f -` invocation.
- `` ```ts `` — first line `// src/<...>.ts` (checked with `tsc`, one
  shared program over every lesson) or
  `// supabase/functions/<name>/index.ts` (a Deno edge function, checked
  standalone with `deno check` — its own module graph/globals).
- `` ```bash `` — first line `# scripts/<name>.sh` (`bash -n` — syntax
  only, never executed).
- A first line containing `@expect-error` (any comment style) is a
  deliberate-error demo: counted, never written to disk, never run.
- `import type { Database } from '../database.types'` resolves for any
  `src/*.ts` fence — the harness copies its one freshly `supabase gen
  types typescript --local`-generated `database.types.ts` into every
  lesson namespace that has an `src/*.ts` fence, at exactly that relative
  position. No specifier-rewriting is needed beyond that (this course has
  no `@/`-alias or cross-lesson-import convention to resolve).
- Fences inside a quiz `export const ... = [...]` array or a
  `<SpotTheBug code={`...`}>` prop are excluded before fence-scanning even
  starts — ported verbatim from `astro-deep-dive/tools/verify-snippets.mjs`
  (itself from that course's `tools/check-parity.mjs`), ready for when this
  course's own Quiz/SpotTheBug port lands (spec §0/§3.5).

### SQL execution model

- **Default / `--all-sql`**: `BEGIN; <fences...>; ROLLBACK;` fed to the
  real `psql` **inside** the running `supabase_db_<project_id>` container
  via `docker exec -i … psql -U postgres -v ON_ERROR_STOP=1 -f -` — proves
  syntax/semantics without persisting anything. `ON_ERROR_STOP=1` means a
  lesson's fences after the first error are never reached in that run
  (same experience a human piping the file through psql would get).
  Diagnostics are parsed from psql's own `psql:<stdin>:<line>: ERROR:`
  output and mapped back to `<mdx path>:fence #n` via per-fence line
  ranges tracked while building the fed buffer.
- **`--apply <module>/<lesson>`**: the same fences, no `BEGIN`/`ROLLBACK`
  wrapper — a real `COMMIT`. Any `supabase/migrations/<name>.sql` or
  `supabase/seed.sql` fence is also persisted to its real path under
  `tools/probe/supabase/`, so a later `supabase db reset` (or a fresh
  `supabase start`) replays it like any real migration.
- **Known caveat** (found via this harness's own development, not
  documented in the platform's own docs): a bad sql fence with an
  **unbalanced paren or quote** can shift psql's client-side statement
  splitter into treating the *next* fence's terminating `;` as its own —
  so the reported line (and therefore the fence attribution) lands on the
  wrong fence. Keep a deliberately-broken sql example free of unbalanced
  `(`/`'`/`"` so the error stays attributed to its own fence.

### Local stack — reuse, ports, do NOT stop it

- `tools/verify-snippets.mjs` starts the probe's stack once
  (`supabase start --workdir tools/probe`) and reuses it on every
  subsequent run (checked via `supabase status`'s exit code) — it is left
  **running** when the script exits, on purpose: Phase 3/4 lesson-writing
  agents reuse it. **Do not run `--stop` on it** as a side effect of
  anything other than a deliberate, explicit teardown.
- Ports are bumped **+1000** from the textbook defaults (API `55321`, DB
  `55322`, shadow DB `55320`, pooler `55329`, Studio `55323`,
  Mailpit/Inbucket `55324`, Analytics `55327`) — a different, unrelated
  Supabase project (`*-rw-fittrack2`) was already running on the textbook
  `54321`-range ports on this host when the probe was first scaffolded
  (`tools/probe`'s `project_id` is `probe`, so container **names** never
  collided — only host ports did). `[db.pooler]` is also flipped
  `enabled = true` (CLI default `false`) so the pooler lesson can prove a
  real local pooler port.
- Studio: `http://127.0.0.1:55323`. DB: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.
  Run `supabase status -o env --workdir tools/probe` for the full set
  (API/anon/service-role keys included).

### Decisions this harness made (spec asked to "decide and document")

1. **No brew, no host `psql`.** `psql` was not installed on the host and
   installing it was off-limits. The local stack's own Postgres container
   already bundles a real, version-matched `psql` — used via
   `docker exec -i supabase_db_<project_id> psql …`. Same real binary,
   same diagnostic format, zero new host dependencies.
2. **Deno.** Not on the host, and (same brew ban) not installable via
   `brew install deno`. Rather than fall back to a `supabase functions
   serve` HTTP smoke test — which proves a function *runs*, not that it
   *type-checks* — this harness installs the official
   [`deno`](https://www.npmjs.com/package/deno) npm package as a
   `tools/probe`-only devDependency (a small shim whose postinstall
   fetches the real per-platform binary; approved through npm's
   install-scripts allowlist, scoped to the gitignored probe project
   only). Edge-function ts fences get a real `deno check`, not a weaker
   smoke test.
3. **Versions resolved at first scaffold** (via `npm view`, not
   hand-pinned): confirm current versions with
   `cd tools/probe && cat package.json` after a fresh `--refresh`, or see
   the harness's own scaffold log. At the time of this wave: Supabase CLI
   `2.117.0`, local Postgres `17.6`, `@supabase/supabase-js@2.117.2`.

### Baseline numbers (current corpus — no path-comment fences yet)

`npm run verify` (default `--check`): **0 collected** sql/ts/bash fences
across all 7 modules + landing page (all 40 real-language fences today are
plain fragments — no path comment yet) → **exit 0**, per the spec's own
gate ("0 collected fine"). Per-module (sql / ts / bash collected —
skipped-no-path — expect-error):

```
auth-and-row-level-security: 0 / 0 / 0 — 9  — 0
auto-generated-api:          0 / 0 / 0 — 11 — 0
client-development:          0 / 0 / 0 — 1  — 0
edge-functions:               0 / 0 / 0 — 3  — 0
foundations:                  1 / 0 / 0 — 6  — 0
production-and-ecosystem:     0 / 0 / 0 — 7  — 0
realtime-and-storage:         0 / 0 / 0 — 3  — 0
TOTAL:                        1 / 0 / 0 — 40 — 0
```

(One sql fence already carries a real path comment by coincidence —
`foundations/tables-schema-and-migrations.mdx`'s
`-- supabase/migrations/20250101000000_create_profiles_table.sql` example —
and it passes for real against the live stack.)

`node tools/verify-snippets.mjs --all-sql` (every sql fence, path comment
or not, run per-lesson): see the harness's own printed
"`--all-sql` per-lesson results" section for exact current pass/fail
counts — expect most non-`foundations` sql fences to **fail**, honestly:
today's sql fragments are illustrative snippets that assume tables/columns
defined in prose or in a different lesson, not a real ordered migration
sequence yet (that's Phase 3/4's job).

### Known gaps

- `imgproxy` (image-transformation service) reports "stopped" in this
  local stack — the CLI starts it lazily on first real use; the
  `image-transformations-and-cdn` lesson's proofs should account for a
  possible cold-start delay on first request.
- Edge function fences are checked with `deno check` only (type-checking),
  never actually served — no `supabase functions serve` smoke test is
  wired up (see Decision #2). If a lesson needs to prove runtime behavior
  (CORS preflight, `EdgeRuntime.waitUntil`, secrets), that's a manual
  `supabase functions serve` step for that lesson's own author, not
  something `npm run verify` covers.
- No pgTAP / `supabase test db` integration — out of scope for this wave
  (see spec §3.2's `verification-tools` lesson, which documents it as
  course *content*, not harness tooling).
