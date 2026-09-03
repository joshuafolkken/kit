import { availableParallelism } from 'node:os'

// How many of the gate's checks run at once, and how wide the one elastic check may fan out —
// both derived from the machine rather than fixed at four (joshuafolkken/kit#1258).
//
// **The measurement this table is built from.** Apple M3 Pro, 11 logical cores (5 performance +
// 6 efficiency, about 9 cores of aggregate throughput on this workload), warm caches, each check
// run alone. `CPU-seconds ÷ wall-seconds` is how many cores the check actually occupies:
//
// | check     | wall  | CPU    | cores |
// | --------- | ----- | ------ | ----- |
// | lint      |  5.2s |  10.8s |   2.1 |
// | check     |  1.4s |   2.3s |   1.7 |
// | cspell    |  1.1s |   1.5s |   1.3 |
// | test:unit | 12.6s | 107.0s |   8.5 |
//
// Two things follow. **The concurrent gate is already the faster shape** — 15.1s together against
// 19.1s back to back, the median of three interleaved runs on the same tree, and the one pair
// `verification-gate.ts` and `docs/josh-commands.md` quote too — so this is a widening of an
// existing win, not a repair of the regression joshuafolkken/kit#1258 was filed for: that was
// real when the type check and the spell check cost 6.9s and 3.6s of CPU, and joshuafolkken/kit#1256
// removed it by giving both a cache. **And the unit suite is the only check worth sizing**: it
// alone accounts for 107 of the 122 CPU-seconds, because vitest opens one worker per core while
// the other three are one or two processes each.

interface GateCheck {
	label: string
	// The `josh` sub-command that defines the check, and the one an appended argument belongs to.
	target: string
	// Cores this check holds for as long as it runs — the measured ratio above, floored to whole
	// cores and never below one. Floored rather than rounded because this is the share the *other*
	// checks must give up: over-reserving costs the elastic check workers it would have used.
	// The unit suite reserves nothing: it sizes its own pool from the machine, so it is capped
	// instead of reserved, and counting it here would reserve cores against itself.
	reserved_cores: number
}

const TYPE_CHECK_LABEL = 'check'
const UNIT_LABEL = 'test:unit'

// The four checks, in the order their output is printed.
const GATE_CHECKS: ReadonlyArray<GateCheck> = [
	{ label: 'lint', target: 'lint', reserved_cores: 2 },
	{ label: TYPE_CHECK_LABEL, target: 'check', reserved_cores: 1 },
	{ label: 'cspell', target: 'cspell:dot', reserved_cores: 1 },
	{ label: UNIT_LABEL, target: UNIT_LABEL, reserved_cores: 0 },
]

// What the three non-elastic checks hold between them: 2 + 1 + 1.
const RESERVED_CORES: number = GATE_CHECKS.reduce((total, check) => total + check.reserved_cores, 0)

// The machine the table above was measured on, and the smallest one the cap is applied to.
//
// **Below it the plan leaves the unit suite alone**, because four reserved cores are a far larger
// share of a small machine than of this one — half an 8-core machine against a third of this — and
// the one measurement that exists says nothing about whether the reservation still pays there.
// Extrapolating it downward is what would hurt: the suite takes 11.7s at 8 workers and 16.7s at 4,
// so a rule that handed an 8-core machine four workers would pin the longest check at the slow end
// of a curve nobody measured on that machine. An unmeasured machine gets the behavior `josh gate`
// had before this plan existed — vitest sizing its own pool — rather than an extrapolated one, and
// a 4-core CI runner is far below the line, which is why this leaves CI running exactly as it did.
const MEASURED_CORES = 11

// At least one check at a time, whatever the machine reports.
const MIN_CONCURRENCY = 1

interface GatePlan {
	// How many checks run at once.
	concurrency: number
	// `--maxWorkers` for the unit suite, or `undefined` to leave the choice to vitest.
	unit_worker_cap: number | undefined
}

// Admit checks in declaration order while the running set's reserved cores still fit the machine.
// It bites only below four cores — the three reserving checks want four between them — and there
// it is the difference between two checks sharing a core and four fighting over it.
function resolve_concurrency(available_cores: number): number {
	let admitted = 0
	let reserved = 0

	for (const check of GATE_CHECKS) {
		reserved += check.reserved_cores

		if (reserved > available_cores) break

		admitted += 1
	}

	return Math.max(MIN_CONCURRENCY, admitted)
}

// The cores left once the other three have their share — on the measured machine, 7 of 11, which
// held the gate's wall time inside run-to-run noise while burning 5–6% less CPU (101s against
// 107s). A machine smaller than the measured one is left uncapped; see `MEASURED_CORES`.
function resolve_unit_worker_cap(available_cores: number): number | undefined {
	if (available_cores < MEASURED_CORES) return undefined

	return available_cores - RESERVED_CORES
}

// `availableParallelism()` rather than `cpus().length`: it reports what this process may actually
// use, so a container with a CPU quota is sized by the quota rather than by the host.
function resolve_gate_plan(available_cores: number = availableParallelism()): GatePlan {
	return {
		concurrency: resolve_concurrency(available_cores),
		unit_worker_cap: resolve_unit_worker_cap(available_cores),
	}
}

// Printed once per run, so a gate that was slow on someone else's machine can be read without
// re-deriving the plan from their core count.
function format_gate_plan(
	plan: GatePlan,
	available_cores: number = availableParallelism(),
): string {
	const cap =
		plan.unit_worker_cap === undefined
			? `${UNIT_LABEL} unrestricted`
			: `${UNIT_LABEL} at ${String(plan.unit_worker_cap)} workers`
	const width = `${String(plan.concurrency)} of ${String(GATE_CHECKS.length)} checks at once`

	return `plan: ${width}, ${cap} (${String(available_cores)} cores)`
}

const gate_plan = {
	GATE_CHECKS,
	MEASURED_CORES,
	RESERVED_CORES,
	TYPE_CHECK_LABEL,
	UNIT_LABEL,
	format_gate_plan,
	resolve_concurrency,
	resolve_gate_plan,
	resolve_unit_worker_cap,
}

export type { GateCheck, GatePlan }
export { gate_plan }
