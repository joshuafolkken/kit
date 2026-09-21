#!/usr/bin/env tsx
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from '#scripts/josh/josh-composite-arguments'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { buffered_process, FAIL_EXIT_CODE } from '#scripts/lib/buffered-process'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { gate_plan, type GateCheck, type GatePlan } from './gate-plan'
import { gate_report, type GateStep, type GateStepResult } from './gate-report'
import { gate_skip } from './gate-skip'
import { gate_tree, type GateTree } from './gate-tree'
import { scoped_green, type ScopedSources } from './scoped-green'
import { type_check_step } from './type-check-step'

// joshuafolkken/kit#914: the completion gate's four checks are independent and share no mutable
// state, yet every entry point ran them one after another — paid again on every `epicrun` child,
// every `/code-review` fix and every `halfrun` stop. Worse than the seconds: a serial gate reports
// one failure at a time, so a tree with a lint error and a type error costs two full round trips to
// discover.
//
// The margin has narrowed as the checks gained caches and is re-measured rather than repeated: on
// this repository today, 19.1s back to back against 15.1s together (joshuafolkken/kit#1258). How
// many run at once, and how wide the unit suite fans out, are `gate-plan.ts`'s to decide.
//
// Each step shells out to the `josh` sub-command that already defines it, rather than repeating the
// underlying tool invocations here — one definition per check, in `josh-commands-development.ts`.

// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2

const JOSH = 'josh'
const { GATE_CHECKS, TYPE_CHECK_LABEL, UNIT_LABEL } = gate_plan

const GATE_TARGETS: ReadonlyArray<string> = GATE_CHECKS.map((check) => check.target)

// vitest's own flag, appended to the sub-command rather than set in `vitest.config.ts`: the config
// is one project's, and the number this carries is a property of the machine the gate is running
// on (joshuafolkken/kit#1258). `josh test:unit` forwards what it is given straight to
// `vitest run`, so nothing between here and vitest has to know about it.
const UNIT_WORKER_FLAG = '--maxWorkers'

function unit_worker_args(check: GateCheck, plan: GatePlan): ReadonlyArray<string> {
	if (check.label !== UNIT_LABEL || plan.unit_worker_cap === undefined) return []

	return [`${UNIT_WORKER_FLAG}=${String(plan.unit_worker_cap)}`]
}

// Only the type check is resolved per project (joshuafolkken/kit#934) — a SvelteKit project
// type-checks through its own toolkit, not through `tsc --noEmit`. Resolving inside the step keeps
// the probe concurrent with the other three checks rather than delaying every one of them.
async function build_gate_step(
	check: GateCheck,
	start_directory: string,
	plan: GatePlan = gate_plan.resolve_gate_plan(),
): Promise<GateStep> {
	if (check.label !== TYPE_CHECK_LABEL) {
		return {
			label: check.label,
			command_args: [JOSH, check.target, ...unit_worker_args(check, plan)],
		}
	}

	return {
		label: check.label,
		command_args: await type_check_step.resolve_type_check_args(start_directory),
	}
}

async function build_gate_steps(
	start_directory: string,
	plan: GatePlan = gate_plan.resolve_gate_plan(),
): Promise<ReadonlyArray<GateStep>> {
	return await Promise.all(
		plan.checks.map(async (check) => await build_gate_step(check, start_directory, plan)),
	)
}

async function run_gate_step(step: GateStep): Promise<GateStepResult> {
	const result = await buffered_process.run_buffered_process(step.command_args)

	return { label: step.label, command: step.command_args.join(' '), ...result }
}

// The record `josh review:brief` reads, written only on a fully green run and only with the tree it
// was green on (joshuafolkken/kit#1241). `/code-review` runs in a forked process that reads none of
// this repository's documents, so "the unit tests already passed" reaches it only if the invocation
// carries it — and it may only carry it if something wrote down that they did, on **this** tree.
//
// **Four things withhold the record, and every one of them is the safe direction.** A step that
// passed *without running* — `test-unit-guard` exits 0 with a notice when vitest is absent or the
// project has no tests — must not become "the unit tests all passed": the gate keeps that skip
// visible on the console, and a record erasing it would have the brief tell a review agent not to
// re-run tests that never ran. A step that passed **with warnings** is withheld for the same reason
// one place further on (joshuafolkken/kit#1328): since the record is now reused instead of the checks
// being re-run, a warning printed once would never be printed again on that tree, and `has_warnings`
// exists precisely because hiding one is the same failure as hiding a skip. A tree that moved while
// the checks were in flight (the `PostToolUse` formatter, an editor save) is not the tree they read.
// And a failed write leaves no record at all, which a temp-directory problem must never turn into a
// red gate.
//
// The destination is a parameter so a test can exercise the record without overwriting the one a
// real run may be relying on — `josh gate` and `josh review:brief` share one path by design.
function has_nothing_to_say(result: GateStepResult): boolean {
	return !gate_report.is_skip_notice(result) && !gate_report.has_warnings(result)
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

// The marker that says a gate is running on this tree right now (joshuafolkken/kit#1242). The gate
// and `/code-review` are started together — neither writes to the working tree — so by the time
// `josh review:brief` composes the invocation the checks are usually still in flight. Without this
// record that state reads as "no gate was ever run", and the review agent runs the unit suite the
// gate is running beside it.
//
// **Both halves swallow their failure, and for the same reason `record_green_gate` does**: the
// marker is a convenience for the next command and nothing about it may reach the gate's verdict. A
// marker that could not be written costs a brief that says `Not verified`, which is the safe
// direction; one that could not be cleared costs nothing beyond the file itself, because since
// joshuafolkken/kit#1245 the record names the writing process by pid **and** start time — so a marker
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

// `bounded_pool` rather than a bare `Promise.all`, so the plan's `concurrency` is what decides how
// many run at once (joshuafolkken/kit#1258). **The all-failures-in-one-pass property survives the
// change** because no check ever rejects: `buffered_process` reports a non-zero exit as a value, so
// the pool's first-failure abort — written for callers that spawn real Claude sessions — never
// fires here and every queued check still runs. Results come back in input order however they
// finished, which is what keeps the printed sections in declaration order.
async function run_gate_steps(plan: GatePlan): Promise<ReadonlyArray<GateStepResult>> {
	const steps = await build_gate_steps(process.cwd(), plan)

	return await bounded_pool.bounded_map(
		steps,
		plan.concurrency,
		async (step) => await run_gate_step(step),
	)
}

async function run_marked_gate_steps(
	before: Record<string, string>,
	plan: GatePlan,
	marker_path?: string,
): Promise<ReadonlyArray<GateStepResult>> {
	return await with_gate_marker(before, async () => await run_gate_steps(plan), marker_path)
}

// **Both markers are claims about the unit suite, so a gate that is not running it makes neither**
// (joshuafolkken/kit#1226). The in-flight marker tells the next `josh review:brief` that a gate is
// covering this tree right now, which is what stops a review agent re-running the suite; the
// unit-run marker tells a sibling lane a vitest run is on the machine, which is what makes that
// lane divide its own workers. A `--no-unit` gate that wrote either would be answering for a check
// it never started — the first by telling a review the tests are covered when they are running in a
// different CI job, the second by throttling a lane on its behalf.
async function run_planned_gate_steps(
	before: Record<string, string>,
	plan: GatePlan,
	marker_path?: string,
): Promise<ReadonlyArray<GateStepResult>> {
	if (!gate_plan.has_unit_check(plan.checks)) return await run_gate_steps(plan)

	return await unit_worker_share.with_run_marker(
		async () => await run_marked_gate_steps(before, plan, marker_path),
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
// handed to both calls. Counted *before* the unit step writes its own marker, so `+ 1` is this gate
// (joshuafolkken/kit#1515).
function announce_gate_plan(is_unit_included: boolean): GatePlan {
	const available_cores = availableParallelism()
	const concurrent_runs = unit_worker_share.live_run_count() + unit_worker_share.SOLO_RUNS
	const plan = gate_plan.resolve_gate_plan(available_cores, concurrent_runs, is_unit_included)

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
	// **The scoped pre-check the CLI entry turns on** (joshuafolkken/kit#2296). Off everywhere else so
	// that a direct `run_verification_gate` call — the whole of `verification-gate.test.ts` — is never
	// refused by a real checkout's missing scoped record; `run_gate_command` sets it true.
	is_scoped_enforced?: boolean
	// The scoped records' paths, overridable so a test can plant a green pair rather than depend on the
	// surrounding checkout's — the reason `scoped-green.ts` takes a `source` per stamp.
	scoped_sources?: ScopedSources
}

// **The gate refuses to start when the scoped pair has not been green on this tree**
// (joshuafolkken/kit#2296) — the same record `josh review:brief` reads, applied one step earlier so the
// first gate is the only gate. It is the CLI entry's check alone (`is_scoped_enforced`), and it never
// fires for CI's `--no-unit` gate or a `--force` run: CI has no scoped record in front of it, and
// `--force` is the caller saying to run regardless. `scoped_green` owns the record and the `JOSH_SCOPED_GREEN`
// escape hatch, so a person can always get past a record that is wrong about their tree.
function scoped_precheck_refusal(tree: GateTree, options: GateOptions): string | undefined {
	if (options.is_scoped_enforced !== true) return undefined
	if (options.is_forced === true || options.is_unit_included === false) return undefined

	return scoped_green.refusal_for(tree.files, tree.base, options.scoped_sources)
}

// **A partial gate records nothing green, and this is the same rule as the skip one layer out**
// (joshuafolkken/kit#1226). The record's whole meaning to `josh review:brief` and to `gate_skip` is
// "every check this repository gates on passed on exactly this tree"; a `--no-unit` run proves three
// of the four, so writing it would let the next full `josh gate` be skipped on a tree whose unit
// suite nobody ran here — a check reporting success without having run, which is the state
// joshuafolkken/kit#1224 exists to refuse.
async function record_whole_gate(
	plan: GatePlan,
	results: ReadonlyArray<GateStepResult>,
	tree: GateTree,
	options: GateOptions,
): Promise<void> {
	if (!gate_plan.has_unit_check(plan.checks)) return

	await record_green_gate(results, tree.files, options.stamp_path, tree.base)
}

// The plan line is printed by the checked path alone. A run that announced a four-way fan-out and
// then skipped would be describing something that never happened, and the skip's own line already
// says everything there is to say about a gate that started no process. The reporting itself is
// `gate-report.ts`'s (joshuafolkken/kit#2296).
async function run_checked_gate(
	tree: GateTree,
	options: GateOptions,
	started_at: number,
): Promise<number> {
	const is_unit_included = options.is_unit_included ?? true
	const plan = announce_gate_plan(is_unit_included)
	// **The gate holds the unit-run marker for its whole run, not just its unit step.** The step that
	// would write it is a subprocess started a second or so after the count above, so two lanes launched
	// together — the shape `epicrun` produces — would both read "nothing else is running" and both take
	// the whole machine. Claimed here, after the count and before any check, it is already there when
	// the next lane asks; the guard inside the spawned `josh test:unit` sees the handoff and adds no
	// second marker for the same run (joshuafolkken/kit#1515).
	const results = await run_planned_gate_steps(tree.files, plan, options.marker_path)
	const failed_labels = gate_report.report_gate_steps(results, {
		is_verbose: options.is_verbose ?? false,
		log_path: options.log_path,
		elapsed_ms: performance.now() - started_at,
		step_count: String(plan.checks.length),
	})

	if (failed_labels.length > 0) return FAIL_EXIT_CODE

	await record_whole_gate(plan, results, tree, options)

	return 0
}

// `--force` is answered here rather than inside `gate_skip`, so the module stays about what the
// record can prove and this one stays about what the caller asked for.
function reusable_stamp(tree: GateTree, options: GateOptions): FileMapStamp | undefined {
	if (options.is_forced === true) return undefined

	return gate_skip.reusable_green_gate(tree.files, tree.base, options.stamp_path)
}

// The two ways a gate ends before it runs a check: a green record it can reuse (exit 0), and the
// scoped pre-check refusing a tree the pair has not been green on (exit 1). `undefined` means neither
// fired and the checks run. **Nothing else stands between the skip and the checks** (joshuafolkken/kit#1486):
// joshuafolkken/kit#1437's `package.json` refusal was removed once children stopped bumping.
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
	process.exitCode = await run_gate_command(process.argv.slice(FIRST_ARGUMENT_INDEX))
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
	run_marked_gate_steps,
	run_planned_gate_steps,
	scoped_precheck_refusal,
	with_gate_marker,
	run_checked_gate,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateOptions }
export type { GateStep, GateStepResult } from './gate-report'
export { GATE_TARGETS, verification_gate }
