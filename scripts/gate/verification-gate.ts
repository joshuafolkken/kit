#!/usr/bin/env tsx
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { buffered_process, FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { core_budget } from './core-budget'
import { gate_ledger, type GateLedgerStart } from './gate-ledger'
import { gate_plan, type GatePlan } from './gate-plan'
import { gate_report, type GateStep, type GateStepResult } from './gate-report'
import { gate_skip } from './gate-skip'
import { build_gate_step, build_gate_steps, UNIT_WORKER_FLAG } from './gate-steps'
import { gate_tree, type GateTree } from './gate-tree'
import { project_checks } from './project-checks'
import { scoped_green, type ScopedSources } from './scoped-green'

// The completion gate's four checks are independent and share no mutable state, so they run
// together. Beyond the seconds: a serial gate reports one failure at a time, so a tree with a lint
// error and a type error would cost two full round trips to discover. How many run at once, and how
// wide the unit suite fans out, are `gate-plan.ts`'s to decide.
//
// Each step shells out to the `josh` sub-command that already defines it, rather than repeating the
// underlying tool invocations here — one definition per check, in `josh-commands-development.ts`.

// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2

const { GATE_CHECKS } = gate_plan

const GATE_TARGETS: ReadonlyArray<string> = GATE_CHECKS.map((check) => check.target)

async function run_gate_step(step: GateStep): Promise<GateStepResult> {
	if (step.skip_reason !== undefined) {
		return {
			label: step.label,
			command: step.command_args.join(' '),
			output: project_checks.skip_notice('check', step.skip_reason),
			exit_code: 0,
			elapsed_ms: 0,
		}
	}

	const result = await buffered_process.run_buffered_process(
		step.command_args,
		step.cwd === undefined ? {} : { cwd: step.cwd },
	)

	return { label: step.label, command: step.command_args.join(' '), ...result }
}

// The record `josh review:brief` reads, written only on a fully green run and only with the tree it
// was green on. `/code-review` runs in a forked process that reads none of
// this repository's documents, so "the unit tests already passed" reaches it only if the invocation
// carries it — and it may only carry it if something wrote down that they did, on **this** tree.
//
// **Four things withhold the record, and every one of them is the safe direction.** A step that
// passed *without running* — `test-unit-guard` exits 0 with a notice when vitest is absent or the
// project has no tests — must not become "the unit tests all passed": the gate keeps that skip
// visible on the console, and a record erasing it would have the brief tell a review agent not to
// re-run tests that never ran. A step that passed **with a checker's warnings** is withheld for the
// same reason one place further on: since the record is reused instead of the checks being re-run, a
// warning printed once would never be printed again on that tree, and hiding an eslint or
// svelte-check finding is the same failure as hiding a skip. It is `has_checker_warning`, not
// `has_warnings`, that decides this: the loose
// marker match is right for the print path, where a false positive costs one printed body, but here a
// false positive withholds the whole record and turns a green gate's `run:review --join` red — so a
// benign line from another tool (a Vite config deprecation on `test:unit`) must not withhold it. A
// tree that moved while
// the checks were in flight (the `PostToolUse` formatter, an editor save) is not the tree they read —
// with no exception: no gate step writes to the tree.
// And a failed write leaves no record at all, which a temp-directory problem must never turn into a
// red gate.
//
// The destination is a parameter so a test can exercise the record without overwriting the one a
// real run may be relying on — `josh gate` and `josh review:brief` share one path by design.
function has_nothing_to_say(result: GateStepResult): boolean {
	return !gate_report.is_skip_notice(result) && !gate_report.has_checker_warning(result)
}

async function record_green_gate(
	results: ReadonlyArray<GateStepResult>,
	before: Record<string, string>,
	target?: string,
	base?: string,
): Promise<void> {
	if (results.some((result) => !has_nothing_to_say(result))) return

	try {
		const after = await review_tree.read_changed_tree()

		if (JSON.stringify(after) !== JSON.stringify(before)) return

		review_stamps.gate_stamp.write(after, target, base)
	} catch {
		/* no record is the safe answer */
	}
}

// The marker that says a gate is running on this tree right now. The gate
// and `/code-review` are started together — neither writes to the working tree — so by the time
// `josh review:brief` composes the invocation the checks are usually still in flight. Without this
// record that state reads as "no gate was ever run", and the review agent runs the unit suite the
// gate is running beside it.
//
// **Both halves swallow their failure, and for the same reason `record_green_gate` does**: the
// marker is a convenience for the next command and nothing about it may reach the gate's verdict. A
// marker that could not be written costs a brief that says `Not verified`, which is the safe
// direction; one that could not be cleared costs nothing beyond the file itself, because the record
// names the writing process by pid **and** start time — so a marker
// this gate leaves behind reads as not running from the moment the gate exits, however long it sits
// there and whatever the operating system later does with that pid. The next gate overwrites it.
function mark_gate_running(before: Record<string, string>, target?: string): void {
	try {
		review_stamps.in_flight_stamp.write(before, target)
	} catch {
		/* no marker is the safe answer */
	}
}

function clear_gate_running(target?: string): void {
	try {
		review_stamps.in_flight_stamp.remove(target)
	} catch {
		/* the next gate overwrites it */
	}
}

// `finally`, so the marker is cleared on a red gate and a thrown check alike. A marker that outlived
// its gate would tell the next brief to wait for a result nobody is going to produce.
//
// The work is a parameter rather than inlined so the clearing can be exercised against a thunk that
// throws — running the real fan-out to prove a `finally` would cost a full gate per assertion, and
// the branch under test is the one the real fan-out is least likely to take.
async function with_gate_marker<T>(
	before: Record<string, string>,
	run: () => Promise<T>,
	target?: string,
): Promise<T> {
	mark_gate_running(before, target)

	try {
		return await run()
	} finally {
		clear_gate_running(target)
	}
}

// This gate's share of the machine, resolved once at the gate's entry and carried down as one value.
// `available_cores` is the budget every check reserves against; `is_reserved`
// is false for a gate nested inside another gate's unit suite — this repository's own gate tests — so
// the outer gate reserves and every gate beneath it does not. Captured before this gate sets
// `JOSH_UNIT_RUN_MARKED`, which is why it is read at entry rather than re-derived here.
interface BudgetContext {
	available_cores: number
	is_reserved: boolean
}

function default_budget(): BudgetContext {
	return {
		available_cores: availableParallelism(),
		is_reserved: !unit_worker_share.is_nested_run() && !core_budget.is_held(),
	}
}

// A gate step paired with the cores it reserves from the machine-wide budget while it runs.
// The weight travels with the step so `run_gate_steps` never has to re-pair a
// step with its check by index.
interface ReservedStep {
	step: GateStep
	weight: number
	memory_mb: number
}

async function build_reserved_steps(
	start_directory: string,
	plan: GatePlan,
	available_cores: number,
): Promise<ReadonlyArray<ReservedStep>> {
	return await Promise.all(
		plan.checks.map(async (check) => ({
			step: await build_gate_step(check, start_directory, plan),
			weight: gate_plan.check_weight(check, plan, available_cores),
			memory_mb: gate_plan.check_memory(check, plan, available_cores),
		})),
	)
}

// **A nested gate takes no reservation, and the budget is what makes that necessary rather than
// merely tidy**. The unit step spawns the suite, which runs this repository's
// own gate tests; each of those is a gate inside the outer gate's unit reservation, and a place it
// claimed would wait for cores the outer gate cannot free until the suite — this test included —
// finishes.
async function run_reserved_step(
	reserved: ReservedStep,
	budget: BudgetContext,
): Promise<GateStepResult> {
	if (!budget.is_reserved) return await run_gate_step(reserved.step)

	return await core_budget.with_core_reservation(
		reserved.weight,
		async (admission) => ({
			...(await run_gate_step(reserved.step)),
			budget_note: core_budget.describe_overflow(admission),
		}),
		{ budget: budget.available_cores, memory_mb: reserved.memory_mb },
	)
}

// `bounded_pool` rather than a bare `Promise.all`, so the plan's `concurrency` is what decides how
// many run at once. **The all-failures-in-one-pass property survives the
// change** because no check ever rejects: `buffered_process` reports a non-zero exit as a value, so
// the pool's first-failure abort — written for callers that spawn real Claude sessions — never
// fires here and every queued check still runs. Results come back in input order however they
// finished, which is what keeps the printed sections in declaration order. Each step first claims its
// place in the machine-wide budget and waits while the budget is full.
async function run_gate_steps(
	plan: GatePlan,
	budget: BudgetContext = default_budget(),
): Promise<ReadonlyArray<GateStepResult>> {
	const reserved = await build_reserved_steps(process.cwd(), plan, budget.available_cores)

	// **The checks run under the held mark, so a check's own dispatch claims nothing**.
	// Each check is a `pnpm josh <target>` child, and a target that declares
	// a weight would otherwise claim a second place for the cores reserved for it here. A nested gate
	// sets the mark too, since its checks are covered by the outer gate's reservation.
	return await core_budget.with_held_mark(
		async () =>
			await bounded_pool.bounded_map(
				reserved,
				plan.concurrency,
				async (entry) => await run_reserved_step(entry, budget),
			),
	)
}

// **Both markers are claims about the unit suite, so a gate that is not running it makes neither**.
// The in-flight marker tells the next `josh review:brief` that a gate is
// covering this tree right now, which is what stops a review agent re-running the suite; the
// unit-run marker tells a sibling lane a vitest run is on the machine, which is what makes that
// lane divide its own workers. A `--no-unit` gate that wrote either would be answering for a check
// it never started — the first by telling a review the tests are covered when they are running in a
// different CI job, the second by throttling a lane on its behalf.
//
// **The work the markers cover ends at the green record, not at the last check**.
// Cleared before `record_green_gate` wrote, the in-flight marker left a gap of tens of milliseconds in
// which `run:review --join` read neither a running gate nor a green one — and answered RED for a gate
// that was about to record green. Cleared after it, a reader that sees no marker is reading a gate
// whose green record, if it has one, is already on disk.
async function run_marked_gate<T>(
	before: Record<string, string>,
	plan: GatePlan,
	work: () => Promise<T>,
	marker_path?: string,
): Promise<T> {
	if (!gate_plan.has_unit_check(plan.checks)) return await work()

	return await unit_worker_share.with_run_marker(
		async () => await with_gate_marker(before, work, marker_path),
	)
}

// The plan goes above the checks rather than beside the summary: it is what the durations under it
// are read against, and a reader who scrolls to the failing check has already passed it.
//
// The core count is read once and handed to both calls. Letting each default to
// `availableParallelism()` would be two independent reads, and a quota changed between them prints
// a core count the plan was not derived from — the one misreading this line exists to prevent.
// The concurrent-run count is read here rather than inside `gate-plan.ts` for the reason the core
// count already is: that module stays a pure function of its inputs, and the machine is asked once and
// handed to both calls. Counted *before* the unit step writes its own marker, so `+ 1` is this gate.
function announce_gate_plan(is_unit_included: boolean, available_cores: number): GatePlan {
	const concurrent_runs = unit_worker_share.live_run_count() + unit_worker_share.SOLO_RUNS
	const is_kit_repository = project_checks.is_kit_repository(process.cwd())
	const plan = gate_plan.resolve_gate_plan(
		available_cores,
		concurrent_runs,
		is_unit_included,
		is_kit_repository,
	)

	process.stdout.write(`${gate_plan.format_gate_plan(plan, available_cores, concurrent_runs)}\n`)

	return plan
}

// `stamp_path` is one option rather than a read path and a write path, because it is one record: the
// green gate this run may reuse is the green gate this run would write. A test that planted a record
// somewhere and let the run record its own elsewhere would be exercising a pair the real command does
// not have. `marker_path` is the in-flight marker's counterpart, and it exists for the same reason
// the other destinations are parameters: this suite runs *inside* `pnpm josh gate`, so a test writing
// to the shared marker would clear the live gate's own.
interface GateOptions {
	is_verbose?: boolean
	is_forced?: boolean
	// Whether the unit suite is one of this gate's checks. Defaults to true everywhere; only
	// `--no-unit` turns it off, for the CI job that runs the suite on a runner of its own.
	is_unit_included?: boolean
	stamp_path?: string
	marker_path?: string
	// The gate log's destination, a parameter for the same reason the two above are: this suite runs
	// inside `pnpm josh gate`, so a test writing to the shared path would overwrite the live gate's
	// own log with the output of four checks that never ran.
	log_path?: string
	// **The scoped pre-check the CLI entry turns on**. Off everywhere else so
	// that a direct `run_verification_gate` call — the whole of `verification-gate.test.ts` — is never
	// refused by a real checkout's missing scoped record; `run_gate_command` sets it true.
	is_scoped_enforced?: boolean
	// The scoped records' paths, overridable so a test can plant a green pair rather than depend on the
	// surrounding checkout's — the reason `scoped-green.ts` takes a `source` per stamp.
	scoped_sources?: ScopedSources
	// The lane ledger a finished gate's duration is appended to. Only the CLI
	// entry resolves it, so a suite driving the gate never writes a measurement of checks that never ran.
	ledger_path?: string | undefined
}

// **The gate refuses to start when the scoped pair has not been green on this tree**
//  — the same record `josh review:brief` reads, applied one step earlier so the
// first gate is the only gate. It is the CLI entry's check alone (`is_scoped_enforced`), and it never
// fires for CI's `--no-unit` gate or a `--force` run: CI has no scoped record in front of it, and
// `--force` is the caller saying to run regardless. `scoped_green` owns the record and the `JOSH_SCOPED_GREEN`
// escape hatch, so a person can always get past a record that is wrong about their tree.
function scoped_precheck_refusal(tree: GateTree, options: GateOptions): string | undefined {
	if (options.is_scoped_enforced !== true) return undefined
	if (options.is_forced === true || options.is_unit_included === false) return undefined

	return scoped_green.refusal_for(tree.files, tree.base, options.scoped_sources)
}

// **A partial gate records nothing green, and this is the same rule as the skip one layer out**.
// The record's whole meaning to `josh review:brief` and to `gate_skip` is
// "every check this repository gates on passed on exactly this tree"; a `--no-unit` run proves three
// of the four, so writing it would let the next full `josh gate` be skipped on a tree whose unit
// suite nobody ran here — a check reporting success without having run, which is the state the
// skip rule exists to refuse.
async function record_whole_gate(
	plan: GatePlan,
	results: ReadonlyArray<GateStepResult>,
	tree: GateTree,
	options: GateOptions,
): Promise<void> {
	if (!gate_plan.has_unit_check(plan.checks)) return

	await record_green_gate(results, tree.files, options.stamp_path, tree.base)
}

// Reports the checks and records a green result — inside the markers, so the in-flight one outlives
// the record it announces.
async function settle_gate(
	plan: GatePlan,
	results: ReadonlyArray<GateStepResult>,
	tree: GateTree,
	options: GateOptions & { started_at: number; ledger: GateLedgerStart },
): Promise<number> {
	const elapsed_ms = performance.now() - options.started_at
	const failed_labels = gate_report.report_gate_steps(results, {
		is_verbose: options.is_verbose ?? false,
		log_path: options.log_path,
		elapsed_ms,
		step_count: String(plan.checks.length),
	})
	const is_passed = failed_labels.length === 0

	await gate_ledger.record(options.ledger, results, { elapsed_ms, is_passed })

	if (!is_passed) return FAIL_EXIT_CODE

	await record_whole_gate(plan, results, tree, options)

	return 0
}

// The plan line is printed by the checked path alone. A run that announced a four-way fan-out and
// then skipped would be describing something that never happened, and the skip's own line already
// says everything there is to say about a gate that started no process. The reporting itself is
// `gate-report.ts`'s.
async function run_checked_gate(
	tree: GateTree,
	options: GateOptions,
	started_at: number,
): Promise<number> {
	const is_unit_included = options.is_unit_included ?? true
	// Read before the concurrent-run count, never between it and the marker below: the reading waits out
	// a sample window, and a lane counting inside that window would miss this gate.
	const ledger = await gate_ledger.start(options.ledger_path)
	// Resolved at the gate's entry, before this gate sets `JOSH_UNIT_RUN_MARKED`, so a gate nested in the
	// unit suite reads the flag as set and reserves nothing.
	const budget = default_budget()
	const plan = announce_gate_plan(is_unit_included, budget.available_cores)

	// **The gate holds the unit-run marker for its whole run, not just its unit step.** The step that
	// would write it is a subprocess started a second or so after the count above, so two lanes launched
	// together — the shape `epicrun` produces — would both read "nothing else is running" and both take
	// the whole machine. Claimed here, after the count and before any check, it is already there when
	// the next lane asks; the guard inside the spawned `josh test:unit` sees the handoff and adds no
	// second marker for the same run.
	async function run_and_settle(): Promise<number> {
		const results = await run_gate_steps(plan, budget)

		return await settle_gate(plan, results, tree, { ...options, started_at, ledger })
	}

	return await run_marked_gate(tree.files, plan, run_and_settle, options.marker_path)
}

// `--force` is answered here rather than inside `gate_skip`, so the module stays about what the
// record can prove and this one stays about what the caller asked for.
function reusable_stamp(tree: GateTree, options: GateOptions): FileMapStamp | undefined {
	if (options.is_forced === true) return undefined

	return gate_skip.reusable_green_gate(tree.files, tree.base, options.stamp_path)
}

// The two ways a gate ends before it runs a check: a green record it can reuse (exit 0), and the
// scoped pre-check refusing a tree the pair has not been green on (exit 1). `undefined` means neither
// fired and the checks run. **Nothing else stands between the skip and the checks.**
function short_circuit_gate(tree: GateTree, options: GateOptions): number | undefined {
	const reusable = reusable_stamp(tree, options)

	if (reusable !== undefined) {
		process.stdout.write(`${gate_skip.format_skip(reusable.taken_at)}\n`)

		return 0
	}

	const scoped_refusal = scoped_precheck_refusal(tree, options)

	if (scoped_refusal === undefined) return undefined

	process.stderr.write(`${scoped_refusal}\n`)

	return FAIL_EXIT_CODE
}

async function run_verification_gate(options: GateOptions = {}): Promise<number> {
	// Started before the tree read, so the total is what the caller waited for rather than what the
	// four checks alone took — the gate's own bookkeeping is part of the wait either way.
	const started_at = performance.now()
	const tree = await gate_tree.read_gate_tree()
	const short_circuit = short_circuit_gate(tree, options)

	if (short_circuit !== undefined) return short_circuit

	return await run_checked_gate(tree, options, started_at)
}

// `josh gate` fans out to four sub-commands and forwards nothing to them, so an appended flag
// would vanish exactly the way it does behind an `sh -c` composite — a run that looks configured
// and is not. The composite guard only inspects `shell` entries, so a `script` entry that fans out
// has to refuse for itself; the message comes from that guard so the two read identically.
// `--verbose` and `--force` are consumed here rather than forwarded, which is why they do not fall
// foul of the refusal above: the refusal exists because a forwarded flag vanishes into the
// sub-commands, and a flag the gate reads itself never reaches them. Every other argument is still
// refused.
const VERBOSE_FLAG = '--verbose'
// Read here and never forwarded, exactly as the two above are: it selects which sub-commands the
// gate fans out to rather than being passed to one of them.
const NO_UNIT_FLAG = '--no-unit'
const ACCEPTED_FLAGS: ReadonlyArray<string> = [VERBOSE_FLAG, gate_skip.FORCE_FLAG, NO_UNIT_FLAG]

// The flags are the caller's, the destinations are the run's, so the two are merged here rather than
// letting an option override a flag the user typed.
async function run_gate_command(
	extra_arguments: ReadonlyArray<string>,
	options: GateOptions = {},
): Promise<number> {
	const unknown = extra_arguments.filter((argument) => !ACCEPTED_FLAGS.includes(argument))

	if (unknown.length > 0) {
		// The shared refusal, plus the arguments it is actually about. Some flags are accepted, so the
		// bare "takes no extra arguments" would send a reader to drop the ones that work. The list is
		// interpolated rather than spelled out here, so adding a flag cannot leave this line stale.
		process.stderr.write(
			`${composite_arguments.format_rejection(GATE_COMMAND, GATE_TARGETS)}\n` +
				`  refused: ${unknown.join(' ')}\n` +
				`  accepted here: ${ACCEPTED_FLAGS.join(' ')}\n`,
		)

		return USAGE_ERROR_EXIT_CODE
	}

	return await run_verification_gate({
		is_scoped_enforced: true,
		...options,
		is_verbose: extra_arguments.includes(VERBOSE_FLAG),
		is_forced: extra_arguments.includes(gate_skip.FORCE_FLAG),
		is_unit_included: !extra_arguments.includes(NO_UNIT_FLAG),
	})
}

// `process.exitCode` rather than `process.exit()`: the gate's output is buffered per step and
// written all at once, and `process.exit()` truncates a piped stdout at its buffer size — the
// summary, written last, is the first thing lost. Setting the code lets the writes drain and the
// process end on its own, which it can, since every child has already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_gate_command(process.argv.slice(FIRST_ARGUMENT_INDEX), {
		ledger_path: await lane_ledger.target(),
	})
}

const verification_gate = {
	ACCEPTED_FLAGS,
	NO_UNIT_FLAG,
	UNIT_WORKER_FLAG,
	VERBOSE_FLAG,
	build_gate_step,
	build_gate_steps,
	clear_gate_running,
	mark_gate_running,
	record_green_gate,
	run_gate_steps,
	scoped_precheck_refusal,
	with_gate_marker,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateOptions }
export type { GateStep, GateStepResult } from './gate-report'
export { GATE_TARGETS, verification_gate }
