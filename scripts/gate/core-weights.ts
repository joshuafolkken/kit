// The weights heavy tools declare to the core budget (`core-budget.ts`), in their own module so the
// ledger's file stays under its line ceiling.

// **The cores each heavy tool occupies, declared once for both places that reserve them**
// `gate-plan.ts`'s checks and the `josh` commands that run the same tools
// directly read these, so a direct `josh lint` claims what the gate's lint claims. The lint, type check
// and spell check numbers are `gate-plan.ts`'s measured table, floored. The whole-tree eslint scan
// behind `josh lines` and `josh refactor:scan` runs in one process: measured cold on the 11-core
// machine on 2026-10-06, 113s of CPU over 98s of wall, so it gets one core.
//
// The rest ran outside the ledger until joshuafolkken/kit#3944, measured with `/usr/bin/time -l` on the
// same machine on 2026-10-17 under a load average of 16. Every one stays under one core, so each takes
// one: `prettier --check` over 40 staged files 2.1s of CPU over 1.7s of wall (`format`), `josh
// retrospective` 16.5s over 19.8s, and a fresh lane's `pnpm install --frozen-lockfile` 1.9s over 6.1s.
// `e2e` is the Playwright worker count `josh test:e2e` passes locally — the two-worker run CI already
// sizes for its four-core runner — since kit has no e2e suite of its own to time.
const CORE_WEIGHTS = {
	lint: 2,
	type_check: 1,
	spell_check: 1,
	eslint_scan: 1,
	format: 1,
	retrospective: 1,
	install: 1,
	e2e: 2,
} as const

// **The memory each heavy tool holds, declared beside its cores**: peak
// resident size in MB, rounded up. Measured with `/usr/bin/time -l` on the 11-core / 18 GB machine on
// 2026-10-07: the type check 1,244 MB, the spell check 330 MB, and one unit worker 319 MB over 54 test
// files. Typed eslint was 1,207 MB over one directory and was observed at 1.6–2.4 GB per whole-tree
// `eslint .` with three lanes running the same day, so lint and the whole-tree scan take that peak.
// On 2026-10-17: prettier 260 MB, the retrospective 862 MB and a lane install 65 MB.
const MEMORY_MB = {
	lint: 2400,
	type_check: 1300,
	spell_check: 350,
	eslint_scan: 2400,
	unit_worker: 350,
	format: 300,
	retrospective: 900,
	install: 100,
} as const

const core_weights = { CORE_WEIGHTS, MEMORY_MB }

export { core_weights }
