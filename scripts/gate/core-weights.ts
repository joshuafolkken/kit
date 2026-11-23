// The weights heavy tools declare to the core budget (`core-budget.ts`), in their own module so the
// ledger's file stays under its line ceiling.

// One tool's measured run: its CPU seconds over its wall seconds, the cores it kept busy on average.
interface Measurement {
	cpu_s: number
	wall_s: number
}

// **What each heavy tool was measured at, on the 11-core machine.** The whole-tree eslint scan behind
// `josh lines` and `josh refactor:scan`, cold on 2026-10-06. Lint's hand measurement (16.9 s over
// 14 s) gave way to its ledger p90, below in `LEDGER_P90` with its period, runs and p90
// (joshuafolkken/kit#7776). The type check with `/usr/bin/time -l` on
// 2026-10-21 under a load average of 14. `prettier --check` over 40 staged files, `josh retrospective`
// and a fresh lane's `pnpm install --frozen-lockfile` with `/usr/bin/time -l` on 2026-10-17 under a
// load average of 16. The gate ledger records each check's CPU beside its duration (`check-cpu.ts`),
// so these can be re-measured from it. The spell check was re-measured from it
// (joshuafolkken/kit#5140): its median CPU and median wall over the lane ledger's 413 gate `cspell`
// runs that were not reused, from 2026-10-24 to 2026-10-27, whose per-run cores had a median of 0.91
// and a p90 of 1.31 — one core rounded up, where the single 2026-10-21 run of 6.0s over 5.6s had
// rounded up to two.
const MEASURED = {
	type_check: { cpu_s: 31.2, wall_s: 27.3 },
	spell_check: { cpu_s: 5.7, wall_s: 6.2 },
	eslint_scan: { cpu_s: 113, wall_s: 98 },
	format: { cpu_s: 2.1, wall_s: 1.7 },
	retrospective: { cpu_s: 16.5, wall_s: 19.8 },
	install: { cpu_s: 1.9, wall_s: 6.1 },
} as const satisfies Readonly<Record<string, Measurement>>

// **What the gate's lint and metrics kept busy, read off the lane ledger** (joshuafolkken/kit#7776):
// the 90th percentile of each measured run's cores (`cpu_ms ÷ elapsed_ms`, the `cores p90` column of
// `josh lane:stats`' `check / claim` table) from 2026-11-10 to 2026-11-17: lint 1.675 over 667 runs
// (maximum 1.889), metrics 1.706 over 337 runs (maximum 1.895). A sample this size bounds what one run
// holds, so these round up to a tenth of a core rather than a whole one: the whole-core round left lint
// at 2 against a median of 1.5, and lint claims queued for 13365 s that week. Metrics had borrowed the
// eslint scan's two cores. The `check` row (the type check) stays a hand measurement rounded to a
// whole core: its p90 was 1.734 but its maximum 4.621, past even the two it claims.
const LEDGER_P90 = {
	lint: 1.675,
	metrics: 1.706,
} as const satisfies Readonly<Record<string, number>>

// A ledger weight's step: a tenth of a core, the precision `josh lane:stats` prints.
const TENTHS = 10
// Digits a sum of tenths keeps before rounding, so `0.1 + 0.2` reads as three tenths and not as four.
const SUM_DIGITS = 6

// **Rounded up, never down** (joshuafolkken/kit#4362): the floored table of joshuafolkken/kit#3354 let
// a 1.15-core eslint scan claim one, so the budget admitted more than the machine had. A single hand
// measurement rounds to a whole core; a ledger p90 rounds to a tenth (`tenth_rounded_up`).
function rounded_up(measurement: Measurement): number {
	return Math.ceil(measurement.cpu_s / measurement.wall_s)
}

// `cores` rounded up to a tenth of a core, past the float noise a sum of tenths carries.
function tenth_rounded_up(cores: number): number {
	return Math.ceil(Number((cores * TENTHS).toFixed(SUM_DIGITS))) / TENTHS
}

// The whole cores a sum of reservations covers, rounded up past the same float noise.
function whole_cores(cores: number): number {
	return Math.ceil(tenth_rounded_up(cores))
}

// **The cores each heavy tool occupies, declared once for both places that reserve them**
// `gate-plan.ts`'s checks and the `josh` commands that run the same tools
// directly read these, so a direct `josh lint` claims what the gate's lint claims. Each is its
// measurement rounded up. `e2e` is the Playwright worker count `josh test:e2e` passes locally — the
// two-worker run CI already sizes for its four-core runner — since kit has no e2e suite of its own to
// time.
const CORE_WEIGHTS = {
	lint: tenth_rounded_up(LEDGER_P90.lint),
	metrics: tenth_rounded_up(LEDGER_P90.metrics),
	type_check: rounded_up(MEASURED.type_check),
	spell_check: rounded_up(MEASURED.spell_check),
	eslint_scan: rounded_up(MEASURED.eslint_scan),
	format: rounded_up(MEASURED.format),
	retrospective: rounded_up(MEASURED.retrospective),
	install: rounded_up(MEASURED.install),
	e2e: 2,
} as const

// joshuafolkken/kit#6331: whole-tree typed lint holds the root TypeScript program and every
// module's import/export metadata, and ran out of V8's default heap — in CI and locally alike.
// `eslint-heap.ts` launches eslint under this heap. It is a crash ceiling, not what eslint holds.
const ESLINT_HEAP_MIB = 8192
const BYTES_PER_MIB = 1_048_576
const BYTES_PER_MB = 1_000_000

// **What one eslint process held at its peak footprint** (joshuafolkken/kit#8840): a lone cold
// whole-tree `eslint . --cache --cache-strategy content` run's peak footprint (`/usr/bin/time -l`),
// rounded up to a hundred. Footprint, not resident size, because compression shrinks resident size
// under the very pressure this reservation guards against. The lane ledger's largest single-process
// footprint sits under it — its periodic samples miss a short peak. The heap cap stays the crash
// ceiling (joshuafolkken/kit#6684): the reservation is the peak, not the cap. The readings are on
// joshuafolkken/kit#8840.
const LEDGER_PEAK_MB = {
	eslint: 8000,
} as const satisfies Readonly<Record<string, number>>

// The heap cap in the ledger's megabytes, rounded up.
const ESLINT_HEAP_MB = Math.ceil((ESLINT_HEAP_MIB * BYTES_PER_MIB) / BYTES_PER_MB)

// **An eslint run's reservation: its measured peak, or the heap cap while none is measured.**
// Without a ledger reading nothing bounds eslint below the heap it may grow to, so the claim falls
// back to the whole cap — the safe side, at the cost of admitting one eslint at a time.
function eslint_claim_mb(measured_peak_mb?: number): number {
	return measured_peak_mb ?? ESLINT_HEAP_MB
}

const ESLINT_PEAK_MB = eslint_claim_mb(LEDGER_PEAK_MB.eslint)

// **Memory reservations cover peak resident size, rounded up.** Lint and the whole-tree scan share
// eslint's measured single-process peak. Unit workers use a whole-suite reading because a small subset misses their
// later growth (joshuafolkken/kit#4528). Metrics uses the cache-miss peak because its parent retains
// its heap beside the merge-base child (joshuafolkken/kit#4595). E2E reserves the full Playwright
// process tree, including the dev server, once per run rather than per worker (joshuafolkken/kit#5413).
// Type check uses the cold incremental peak — no `.tsbuildinfo` — because the warm peak is less than
// half of it and a fresh lane starts cold (joshuafolkken/kit#7131).
const MEMORY_MB = {
	lint: ESLINT_PEAK_MB,
	metrics: 1900,
	type_check: 2900,
	spell_check: 350,
	eslint_scan: ESLINT_PEAK_MB,
	unit_worker: 400,
	format: 300,
	retrospective: 900,
	install: 100,
	e2e: 1800,
} as const

// **The program a command launches, mapped to the `MEMORY_MB` row it holds** — the one table
// `command-memory.ts` reads a wrapped command's memory off. `install` is `pnpm install` read past its
// `pnpm` wrapper (`git_argv.program_of`).
const TOOL_MEMORY: Readonly<Partial<Record<string, keyof typeof MEMORY_MB>>> = {
	eslint: 'lint',
	tsc: 'type_check',
	cspell: 'spell_check',
	vitest: 'unit_worker',
	prettier: 'format',
	install: 'install',
	playwright: 'e2e',
}

const core_weights = {
	CORE_WEIGHTS,
	ESLINT_HEAP_MB,
	ESLINT_HEAP_MIB,
	LEDGER_P90,
	LEDGER_PEAK_MB,
	MEASURED,
	MEMORY_MB,
	TOOL_MEMORY,
	eslint_claim_mb,
	tenth_rounded_up,
	whole_cores,
}

export { core_weights }
