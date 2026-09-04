#!/usr/bin/env tsx
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { bounded_pool } from './bounded-pool'
import { buffered_process, FAIL_EXIT_CODE, type BufferedProcessResult } from './buffered-process'
import { gate_plan, type GateCheck, type GatePlan } from './gate-plan'
import { gate_skip } from './gate-skip'
import { gate_tree, type GateTree } from './gate-tree'
import type { FileMapStamp } from './josh/file-map-stamp'
import { GATE_COMMAND } from './josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh/josh-composite-arguments'
import { review_stamps } from './review/review-stamps'
import { review_tree } from './review/review-tree'
import { test_unit_guard } from './test-unit-guard'
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

const PASS_ICON = '✔'
const FAIL_ICON = '✗'
// `process.argv` is [runner, script, ...arguments].
const FIRST_ARGUMENT_INDEX = 2

interface GateStep {
	label: string
	command_args: ReadonlyArray<string>
}

interface GateStepResult extends BufferedProcessResult {
	label: string
	// What was actually run. The type check's command is resolved per project, so a failure on the
	// `check` step is only reproducible if the header names the command rather than the label.
	command: string
}

const JOSH = 'josh'
const { GATE_CHECKS, TYPE_CHECK_LABEL, UNIT_LABEL } = gate_plan

const GATE_TARGETS: ReadonlyArray<string> = GATE_CHECKS.map((check) => check.target)
const STEP_COUNT = String(GATE_CHECKS.length)

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
		GATE_CHECKS.map(async (check) => await build_gate_step(check, start_directory, plan)),
	)
}

async function run_gate_step(step: GateStep): Promise<GateStepResult> {
	const result = await buffered_process.run_buffered_process(step.command_args)

	return { label: step.label, command: step.command_args.join(' '), ...result }
}

function is_gate_step_failed(result: GateStepResult): boolean {
	return buffered_process.is_process_failed(result)
}

// A passing check's output is not read. What a green gate has to say is "all four passed", and
// `print_gate_summary` already says it in one line — while the four bodies, vitest's per-file
// listing among them, run to tens of kilobytes that then sit in the conversation and are re-read on
// every later turn. The gate runs more than once per Issue, so the cost is per run, not per Issue
// (joshuafolkken/kit#967).
//
// A failing check keeps its whole output: that is the one time the body is the answer. So does a
// check that **passed without running** — `test-unit-guard` exits 0 with a notice when vitest is
// absent or the project has no tests, and suppressing that made a gate which ran zero tests print
// the same five lines as one that ran them all. The marker comes from the guard itself rather than
// being matched by eye, so the two cannot drift apart.
function is_skip_notice(result: GateStepResult): boolean {
	return result.output.includes(test_unit_guard.SKIP_MARKER)
}

// A check can exit 0 and still have something to say: `lint-parallel` runs eslint without
// `--max-warnings 0`, and svelte-check reports warnings the same way. Suppressing those would let a
// gate report "passed" with the warnings invisible, which is the same failure as hiding a skip.
//
// Unlike the skip marker this *is* a heuristic — the words come from third-party tools, so there is
// no constant to share with them. It is deliberately loose: a false positive costs one printed body,
// a false negative hides a warning, and only one of those is worth avoiding.
const WARNING_MARKERS: ReadonlyArray<string> = ['warning', 'Warning', '⚠']

function has_warnings(result: GateStepResult): boolean {
	return WARNING_MARKERS.some((marker) => result.output.includes(marker))
}

function should_print_body(result: GateStepResult, is_verbose: boolean): boolean {
	if (is_verbose || is_gate_step_failed(result)) return true

	return is_skip_notice(result) || has_warnings(result)
}

// Seconds to one decimal, which is the resolution the answer is read at: the question a gate's
// timing answers is "which of the four is the long pole", and no check is ever separated from
// another by less than a tenth of a second (joshuafolkken/kit#1248).
const MS_PER_SECOND = 1000
const SECONDS_DECIMALS = 1

function format_seconds(elapsed_ms: number): string {
	return `${(elapsed_ms / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)}s`
}

// The duration goes at the **end** of the header, after the command. The header's first job is
// naming the one command to re-run while fixing (`docs/josh-commands.md` → `josh gate`), and a
// number spliced in front of it would push that name out of the place a reader scans for it.
function print_gate_step(result: GateStepResult, is_verbose: boolean): void {
	const icon = is_gate_step_failed(result) ? FAIL_ICON : PASS_ICON

	process.stdout.write(
		`\n${icon} ${result.label} (pnpm ${result.command}) ${format_seconds(result.elapsed_ms)}\n`,
	)

	if (should_print_body(result, is_verbose) && result.output) {
		process.stdout.write(`${result.output}\n`)
	}
}

// The total is wall-clock for the whole command, not the sum of the four — they run concurrently,
// so a sum would report about three times what the caller waited. It is what the four are read
// against: four checks at 9s, 5s, 3s and 15s against a total of 23s says the fan-out is working,
// and the same four against 80s says the machine was contended rather than any check being slow.
function print_gate_summary(failed_labels: ReadonlyArray<string>, elapsed_ms: number): void {
	const total = format_seconds(elapsed_ms)

	if (failed_labels.length === 0) {
		process.stdout.write(
			`\n${PASS_ICON} verification gate passed (${STEP_COUNT} checks) in ${total}.\n`,
		)

		return
	}

	process.stdout.write(
		`\n${FAIL_ICON} verification gate failed: ${failed_labels.join(', ')} (${total})\n`,
	)
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
	return !is_skip_notice(result) && !has_warnings(result)
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
// direction; one that could not be cleared costs a brief that says a gate is running when none is —
// which still claims no result, and which the next gate overwrites.
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
async function run_marked_gate_steps(
	before: Record<string, string>,
	plan: GatePlan,
	marker_path?: string,
): Promise<ReadonlyArray<GateStepResult>> {
	return await with_gate_marker(
		before,
		async () => {
			const steps = await build_gate_steps(process.cwd(), plan)

			return await bounded_pool.bounded_map(
				steps,
				plan.concurrency,
				async (step) => await run_gate_step(step),
			)
		},
		marker_path,
	)
}

// The plan goes above the checks rather than beside the summary: it is what the durations under it
// are read against, and a reader who scrolls to the failing check has already passed it.
//
// The core count is read once and handed to both calls. Letting each default to
// `availableParallelism()` would be two independent reads, and a quota changed between them prints
// a core count the plan was not derived from — the one misreading this line exists to prevent.
function announce_gate_plan(): GatePlan {
	const available_cores = availableParallelism()
	const plan = gate_plan.resolve_gate_plan(available_cores)

	process.stdout.write(`${gate_plan.format_gate_plan(plan, available_cores)}\n`)

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
	stamp_path?: string
	marker_path?: string
}

// The plan line is printed by the checked path alone. A run that announced a four-way fan-out and
// then skipped would be describing something that never happened, and the skip's own line already
// says everything there is to say about a gate that started no process.
async function run_checked_gate(
	tree: GateTree,
	options: GateOptions,
	started_at: number,
): Promise<number> {
	const plan = announce_gate_plan()
	const results = await run_marked_gate_steps(tree.files, plan, options.marker_path)

	for (const result of results) print_gate_step(result, options.is_verbose ?? false)

	const failed_labels = results
		.filter((result) => is_gate_step_failed(result))
		.map((result) => result.label)

	print_gate_summary(failed_labels, performance.now() - started_at)

	if (failed_labels.length > 0) return FAIL_EXIT_CODE

	await record_green_gate(results, tree.files, options.stamp_path, tree.base)

	return 0
}

// `--force` is answered here rather than inside `gate_skip`, so the module stays about what the
// record can prove and this one stays about what the caller asked for.
function reusable_stamp(tree: GateTree, options: GateOptions): FileMapStamp | undefined {
	if (options.is_forced === true) return undefined

	return gate_skip.reusable_green_gate(tree.files, tree.base, options.stamp_path)
}

async function run_verification_gate(options: GateOptions = {}): Promise<number> {
	// Started before the tree read, so the total is what the caller waited for rather than what the
	// four checks alone took — the gate's own bookkeeping is part of the wait either way.
	const started_at = performance.now()
	const tree = await gate_tree.read_gate_tree()
	const reusable = reusable_stamp(tree, options)

	if (reusable === undefined) return await run_checked_gate(tree, options, started_at)

	process.stdout.write(`${gate_skip.format_skip(reusable.taken_at)}\n`)

	return 0
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
const ACCEPTED_FLAGS: ReadonlyArray<string> = [VERBOSE_FLAG, gate_skip.FORCE_FLAG]

// The flags are the caller's, the destinations are the run's, so the two are merged here rather than
// letting an option override a flag the user typed.
async function run_gate_command(
	extra_arguments: ReadonlyArray<string>,
	options: GateOptions = {},
): Promise<number> {
	const unknown = extra_arguments.filter((argument) => !ACCEPTED_FLAGS.includes(argument))

	if (unknown.length > 0) {
		// The shared refusal, plus the arguments it is actually about. Two flags are accepted, so the
		// bare "takes no extra arguments" would send a reader to drop the ones that work.
		process.stderr.write(
			`${composite_arguments.format_rejection(GATE_COMMAND, GATE_TARGETS)}\n` +
				`  refused: ${unknown.join(' ')}\n` +
				`  accepted here: ${ACCEPTED_FLAGS.join(' ')}\n`,
		)

		return USAGE_ERROR_EXIT_CODE
	}

	return await run_verification_gate({
		...options,
		is_verbose: extra_arguments.includes(VERBOSE_FLAG),
		is_forced: extra_arguments.includes(gate_skip.FORCE_FLAG),
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
	UNIT_WORKER_FLAG,
	VERBOSE_FLAG,
	build_gate_step,
	build_gate_steps,
	clear_gate_running,
	is_gate_step_failed,
	mark_gate_running,
	record_green_gate,
	run_marked_gate_steps,
	with_gate_marker,
	run_checked_gate,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateOptions, GateStep, GateStepResult }
export { GATE_TARGETS, verification_gate }
