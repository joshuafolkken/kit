// The weights heavy tools declare to the core budget (`core-budget.ts`), in their own module so the
// ledger's file stays under its line ceiling.

// One tool's measured run: its CPU seconds over its wall seconds, the cores it kept busy on average.
interface Measurement {
	cpu_s: number
	wall_s: number
}

// **What each heavy tool was measured at, on the 11-core machine.** The whole-tree eslint scan behind
// `josh lines` and `josh refactor:scan`, cold on 2026-10-06. eslint over 40 staged files
// (`pre-commit-lint.ts`), which the gate's lint also runs beside its sibling linters, so it is the
// lint's floor; whole runs were observed at 124–147% CPU. The type check with `/usr/bin/time -l` on
// 2026-10-21 under a load average of 14. `prettier --check` over 40 staged files, `josh retrospective`
// and a fresh lane's `pnpm install --frozen-lockfile` with `/usr/bin/time -l` on 2026-10-17 under a
// load average of 16. The gate ledger records each check's CPU beside its duration (`check-cpu.ts`),
// so these can be re-measured from it. The spell check is (joshuafolkken/kit#5140): its median CPU and
// median wall over the lane ledger's 413 gate `cspell` runs that were not reused from 2026-10-24 to 2026-10-27,
// whose per-run cores had a median of 0.91 and a p90 of 1.31 — one core rounded up, where the single
// 2026-10-21 run of 6.0s over 5.6s had rounded up to two.
const MEASURED = {
	lint: { cpu_s: 16.9, wall_s: 14 },
	type_check: { cpu_s: 31.2, wall_s: 27.3 },
	spell_check: { cpu_s: 5.7, wall_s: 6.2 },
	eslint_scan: { cpu_s: 113, wall_s: 98 },
	format: { cpu_s: 2.1, wall_s: 1.7 },
	retrospective: { cpu_s: 16.5, wall_s: 19.8 },
	install: { cpu_s: 1.9, wall_s: 6.1 },
} as const satisfies Readonly<Record<string, Measurement>>

// **Rounded up, never down** (joshuafolkken/kit#4362): a weight is a whole number of cores, and the
// floored table of joshuafolkken/kit#3354 let a 1.15-core eslint scan claim one, so the budget admitted
// more than the machine had.
function rounded_up(measurement: Measurement): number {
	return Math.ceil(measurement.cpu_s / measurement.wall_s)
}

// **The cores each heavy tool occupies, declared once for both places that reserve them**
// `gate-plan.ts`'s checks and the `josh` commands that run the same tools
// directly read these, so a direct `josh lint` claims what the gate's lint claims. Each is its
// measurement rounded up. `e2e` is the Playwright worker count `josh test:e2e` passes locally — the
// two-worker run CI already sizes for its four-core runner — since kit has no e2e suite of its own to
// time.
const CORE_WEIGHTS = {
	lint: rounded_up(MEASURED.lint),
	type_check: rounded_up(MEASURED.type_check),
	spell_check: rounded_up(MEASURED.spell_check),
	eslint_scan: rounded_up(MEASURED.eslint_scan),
	format: rounded_up(MEASURED.format),
	retrospective: rounded_up(MEASURED.retrospective),
	install: rounded_up(MEASURED.install),
	e2e: 2,
} as const

// **The memory each heavy tool holds, declared beside its cores**: peak
// resident size in MB, rounded up. Measured with `/usr/bin/time -l` on the 11-core / 18 GB machine on
// 2026-10-07: the type check 1,244 MB, the spell check 330 MB, and one unit worker 319 MB over 54 test
// files. Typed eslint was 1,207 MB over one directory and was observed at 1.6–2.4 GB per whole-tree
// `eslint .` with three lanes running the same day, so lint and the whole-tree scan take that peak.
// On 2026-10-17: prettier 260 MB, the retrospective 862 MB and a lane install 65 MB. On 2026-10-22
// (joshuafolkken/kit#4528) the whole suite, 1,830 files at `--maxWorkers=3` beside four lanes, sampled
// each worker's resident size once a second: the largest peaked at 381 MB, so the 54-file
// measurement had read a worker short of the files it lives through. On 2026-10-23
// (joshuafolkken/kit#4595) `josh metrics`, its process tree sampled four times a second, peaked at
// 1,176 MB on a merge-base cache hit and 1,851 MB on a miss, where its own untyped `max-lines`-only
// eslint pass still holds its heap beside the `--json` child measuring the merge-base. It takes the miss.
const MEMORY_MB = {
	lint: 2400,
	metrics: 1900,
	type_check: 1300,
	spell_check: 350,
	eslint_scan: 2400,
	unit_worker: 400,
	format: 300,
	retrospective: 900,
	install: 100,
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
}

const core_weights = { CORE_WEIGHTS, MEASURED, MEMORY_MB, TOOL_MEMORY }

export { core_weights }
