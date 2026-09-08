import { availableParallelism } from 'node:os'
import { josh_verdict } from './josh-verdict'
import { unit_worker_share } from './unit-worker-share'

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

// The three checks that read the tree without running it, in the order their output is printed.
// They are named apart from the unit suite because CI runs them on their own runner
// (joshuafolkken/kit#1226): the unit suite is the only check that fans out across every core, so on
// a 4-core GitHub runner it and the other three spent the whole job taking cores off each other.
const STATIC_CHECKS: ReadonlyArray<GateCheck> = [
	{ label: 'lint', target: 'lint', reserved_cores: 2 },
	{ label: TYPE_CHECK_LABEL, target: 'check', reserved_cores: 1 },
	{ label: 'cspell', target: 'cspell:dot', reserved_cores: 1 },
]

// The four checks, in the order their output is printed.
const GATE_CHECKS: ReadonlyArray<GateCheck> = [
	...STATIC_CHECKS,
	{ label: UNIT_LABEL, target: UNIT_LABEL, reserved_cores: 0 },
]

// **Selecting is not skipping, and the difference is where the unit suite runs rather than whether
// it runs.** `josh gate --no-unit` exists for one caller — the CI job that has handed the unit suite
// to a runner of its own — and every other entry point still gets all four. What makes the narrower
// set safe is that nothing downstream may mistake it for the full gate: `verification-gate.ts`
// withholds both the green-gate record and the in-flight marker on a partial run, so a `--no-unit`
// gate can never tell `josh review:brief` that the unit suite passed on this tree.
function select_gate_checks(is_unit_included: boolean): ReadonlyArray<GateCheck> {
	return is_unit_included ? GATE_CHECKS : STATIC_CHECKS
}

// Asked of the plan rather than of the flag, so the one question "did this gate run the unit suite"
// has one answer however the plan was built.
function has_unit_check(checks: ReadonlyArray<GateCheck>): boolean {
	return checks.some((check) => check.label === UNIT_LABEL)
}

// What the three non-elastic checks hold between them: 2 + 1 + 1. Reduced over `STATIC_CHECKS`
// rather than over all four, because that is the set the sentence above names: `resolve_unit_worker_cap`
// spends this as the cores the unit suite must leave to its siblings, so summing the unit check into
// it would have the suite subtract its own reservation from its own budget the day that reservation
// stops being zero. The two sets give the same number today, which is exactly why the narrower one
// has to be the declared one.
const RESERVED_CORES: number = STATIC_CHECKS.reduce(
	(total, check) => total + check.reserved_cores,
	0,
)

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

// At least one core to plan against, however many gates are sharing the machine. Without it a
// twelfth lane would divide 11 cores to zero and admit nothing, and `MIN_CONCURRENCY` would be
// covering for an arithmetic accident rather than for a genuinely tiny machine.
const MIN_SHARED_CORES = 1

interface GatePlan {
	// The checks this run fans out to — all four, or the static three when the unit suite has a
	// runner of its own. Carried on the plan rather than re-derived at each use, so the concurrency,
	// the printed plan line and the steps that actually run can never describe different sets.
	checks: ReadonlyArray<GateCheck>
	// How many checks run at once.
	concurrency: number
	// `--maxWorkers` for the unit suite, or `undefined` to leave the choice to vitest.
	unit_worker_cap: number | undefined
}

// This gate's share of the machine — the cores it may plan against once the other gates in flight
// have theirs (joshuafolkken/kit#1547).
//
// **At one run this is the identity, and that is the whole argument that solo behavior is
// unchanged.** `Math.floor(cores / 1)` is `cores`, so a solo gate and a CI runner hand the admission
// below exactly the number they always handed it — not a number that happens to come out the same,
// the same number, by arithmetic — and no branch, flag or environment probe stands between the two
// cases to be got wrong later.
//
// **A run count that is not a number leaves the machine undivided, and the clamp is not cosmetic.**
// `Math.max` propagates `NaN` rather than clamping it, so an unusable count would sail through
// `MIN_SHARED_CORES`, make every `reserved > share` comparison false and admit all four checks —
// the exact opposite of what this function is for. `bounded-pool.ts` closes the same hole for the
// same reason. A count below one is nonsense too and is read as one run, which is the direction
// that leaves behavior where it was rather than throttling a gate on a bad input.
function shared_cores(available_cores: number, concurrent_runs: number): number {
	const runs = Number.isFinite(concurrent_runs)
		? Math.max(unit_worker_share.SOLO_RUNS, concurrent_runs)
		: unit_worker_share.SOLO_RUNS

	return Math.max(MIN_SHARED_CORES, Math.floor(available_cores / runs))
}

// Admit checks in declaration order while the running set's reserved cores still fit **this run's
// share** of the machine. On a machine running one gate that share is the machine, so this bites
// only below four cores — the three reserving checks want four between them — and there it is the
// difference between two checks sharing a core and four fighting over it.
//
// **Under concurrency it is the only lever there is, and that is a measurement rather than a
// preference** (joshuafolkken/kit#1547). `josh gate` starts four checks at once and joshuafolkken/kit#1515
// sized only the fourth, so six lanes put 18 unbounded checks on 11 cores: measured on that machine,
// one gate took 254.1s with lint alone at 252.9s against the 5.2s the table above records for it
// solo. The obvious repair — hand each of the other three a worker count the way the unit suite gets
// one — **does not exist to be applied**: eslint 10's `--concurrency` defaults to `off` and is
// already single-threaded, `tsc` is one process, and cspell's CLI exposes no thread count at all.
// Nothing in those three takes a number, so how many of them run beside each other is the only
// quantity the gate controls, and dividing the machine before admitting them is how it controls it.
//
// **Narrowing is not skipping.** Every one of the four checks still runs, over the same files, and
// the gate still reports every failure in one pass — `bounded_pool` queues what it does not start,
// and no check ever rejects (see `run_marked_gate_steps`). What changes is how many are in flight at
// once, which is scheduling and never coverage.
function resolve_concurrency(
	available_cores: number,
	concurrent_runs: number = unit_worker_share.SOLO_RUNS,
	checks: ReadonlyArray<GateCheck> = GATE_CHECKS,
): number {
	const share = shared_cores(available_cores, concurrent_runs)
	let admitted = 0
	let reserved = 0

	for (const check of checks) {
		reserved += check.reserved_cores

		if (reserved > share) break

		admitted += 1
	}

	return Math.max(MIN_CONCURRENCY, admitted)
}

// The cores left once the other three have their share — on the measured machine, 7 of 11, which
// held the gate's wall time inside run-to-run noise while burning 5–6% less CPU (101s against
// 107s). A machine smaller than the measured one is left uncapped; see `MEASURED_CORES`.
//
// **The table above is a measurement of one gate on an idle machine, and `concurrent_runs` is what
// says whether that is the situation** (joshuafolkken/kit#1515). Six lanes each reading "11 cores,
// take 7" put 42 workers on 11 cores, at a load average of 14.97, and the gate had no way to know the
// other five existed. Where more than one unit run is in flight the machine is divided between them
// instead, by `unit-worker-share.ts`, which is the same answer `test-unit-guard.ts` gives the pre-push
// hook. At one run — every solo gate, CI included — the number is exactly what it was.
//
// **The shared branch drops `RESERVED_CORES`, knowingly, and it is not a strict improvement.** Each
// concurrent gate still runs lint, the type check and the spell check beside its unit step, and the
// share below does not subtract them: on 12 cores a solo gate takes 8 unit workers plus 3 siblings —
// 11 processes for 12 cores — while two concurrent gates take 6 each plus 3 siblings each, which is 18.
// The obvious correction, `⌊(cores − RESERVED_CORES × runs) ÷ runs⌋`, is **not** applied because
// nothing has measured it: it hands two gates on an 11-core machine one worker apiece, against the
// 11.7s-at-8-workers / 16.7s-at-4 curve the table above was built from, and trading a measured
// oversubscription for an unmeasured starvation is not an improvement anyone can defend. What *is*
// measured is the unit half — six concurrent suites went from ten timeouts to none at this share.
//
// **joshuafolkken/kit#1547 narrowed `resolve_concurrency` and deliberately left this number alone.**
// A narrowed gate no longer runs its three siblings *beside* its unit step, so the paragraph above
// now over-states what the share is competing with — which is an argument for widening it, and
// widening it is exactly the unmeasured move that paragraph refuses. The number #1515 measured stays
// until something measures a better one on this machine.
//
// **The count is a parameter rather than a read.** This module stays a pure function of its inputs, so
// its own assertions are about arithmetic and not about what happened to be running while they ran;
// `verification-gate.ts` is where the machine is asked.
function resolve_unit_worker_cap(
	available_cores: number,
	concurrent_runs: number = unit_worker_share.SOLO_RUNS,
): number | undefined {
	const share = unit_worker_share.resolve_unit_workers(available_cores, concurrent_runs)

	if (share !== undefined) return share
	if (available_cores < MEASURED_CORES) return undefined

	return available_cores - RESERVED_CORES
}

// `availableParallelism()` rather than `cpus().length`: it reports what this process may actually
// use, so a container with a CPU quota is sized by the quota rather than by the host.
// The three fields together, for a caller that has already decided the numbers. The gate's own
// suites need plans the resolver would never produce — a serial one, a capped one — and building
// them by hand meant restating the check list at every literal, so a field added to `GatePlan` broke
// each of them individually. One constructor is what keeps a new field from being an edit per plan.
function plan_of(
	concurrency: number,
	unit_worker_cap?: number,
	checks: ReadonlyArray<GateCheck> = GATE_CHECKS,
): GatePlan {
	return { checks, concurrency, unit_worker_cap }
}

//
// **The worker cap follows the checks rather than the machine.** A plan with no unit step has no
// unit suite to size, so it carries no cap — leaving one on would print a worker count for a check
// this run never starts.
function resolve_gate_plan(
	available_cores: number = availableParallelism(),
	concurrent_runs: number = unit_worker_share.SOLO_RUNS,
	is_unit_included = true,
): GatePlan {
	const checks = select_gate_checks(is_unit_included)

	return {
		checks,
		concurrency: resolve_concurrency(available_cores, concurrent_runs, checks),
		unit_worker_cap: is_unit_included
			? resolve_unit_worker_cap(available_cores, concurrent_runs)
			: undefined,
	}
}

// Printed once per run, so a gate that was slow on someone else's machine can be read without
// re-deriving the plan from their core count.
//
// **The two fragments come from `josh-verdict.ts` since joshuafolkken/kit#1379.** `josh time` matches
// this line to tell where a gate run's output begins — it is the one line the gate prints before any
// check body exists — so the printer and the detector build it from the same strings, exactly as they
// already do for the verdict.
// **The machine is described as shared only when it is.** A solo gate prints exactly the line it
// always printed — which is what keeps `josh time`'s detector, and every reader used to the old
// output, unaffected — while a narrowed one says why it is narrow, so a lane owner reading a slow
// gate is not left deriving the reason from a worker count that looks wrong (joshuafolkken/kit#1515).
function format_machine(available_cores: number, concurrent_runs: number): string {
	const cores = `${String(available_cores)} cores`

	if (concurrent_runs <= unit_worker_share.SOLO_RUNS) return cores

	return `${cores}, ${String(concurrent_runs)} unit runs`
}

// **A gate that is not running the unit suite says so where the worker count would go.** The line is
// what a slow or surprising gate is read against, and "3 of 3" alone would leave a reader deriving
// which three from the check bodies below it.
function format_unit_cap(plan: GatePlan): string {
	if (!has_unit_check(plan.checks)) return `${UNIT_LABEL} elsewhere`
	if (plan.unit_worker_cap === undefined) return `${UNIT_LABEL} unrestricted`

	return `${UNIT_LABEL} at ${String(plan.unit_worker_cap)} workers`
}

function format_gate_plan(
	plan: GatePlan,
	available_cores: number = availableParallelism(),
	concurrent_runs: number = unit_worker_share.SOLO_RUNS,
): string {
	const cap = format_unit_cap(plan)
	const count = `${String(plan.concurrency)} of ${String(plan.checks.length)}`
	const width = `${count}${josh_verdict.GATE_OPENING_MARK}`
	const machine = format_machine(available_cores, concurrent_runs)

	return `${josh_verdict.GATE_OPENING_PREFIX}${width}, ${cap} (${machine})`
}

const gate_plan = {
	GATE_CHECKS,
	MEASURED_CORES,
	RESERVED_CORES,
	STATIC_CHECKS,
	TYPE_CHECK_LABEL,
	UNIT_LABEL,
	format_gate_plan,
	format_machine,
	format_unit_cap,
	has_unit_check,
	plan_of,
	resolve_concurrency,
	resolve_gate_plan,
	resolve_unit_worker_cap,
	select_gate_checks,
}

export type { GateCheck, GatePlan }
export { gate_plan }
