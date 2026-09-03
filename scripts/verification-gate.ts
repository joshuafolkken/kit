#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { buffered_process, FAIL_EXIT_CODE, type BufferedProcessResult } from './buffered-process'
import { GATE_COMMAND } from './josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh/josh-composite-arguments'
import { review_stamps } from './review/review-stamps'
import { review_tree } from './review/review-tree'
import { test_unit_guard } from './test-unit-guard'
import { type_check_step } from './type-check-step'

// joshuafolkken/kit#914: the completion gate's four checks are independent and share no mutable
// state, yet every entry point ran them one after another — 31s serial against a 13s longest step,
// paid again on every `epicrun` child, every `/code-review` fix and every `halfrun` stop. Worse
// than the seconds: a serial gate reports one failure at a time, so a tree with a lint error and a
// type error costs two full round trips to discover.
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
const TYPE_CHECK_LABEL = 'check'

interface GateCheck {
	label: string
	// The `josh` sub-command that defines the check, and the one an appended argument belongs to.
	target: string
}

// The four checks, in the order their output is printed.
const GATE_CHECKS: ReadonlyArray<GateCheck> = [
	{ label: 'lint', target: 'lint' },
	{ label: TYPE_CHECK_LABEL, target: 'check' },
	{ label: 'cspell', target: 'cspell:dot' },
	{ label: 'test:unit', target: 'test:unit' },
]

const GATE_TARGETS: ReadonlyArray<string> = GATE_CHECKS.map((check) => check.target)
const STEP_COUNT = String(GATE_CHECKS.length)

// Only the type check is resolved per project (joshuafolkken/kit#934) — a SvelteKit project
// type-checks through its own toolkit, not through `tsc --noEmit`. Resolving inside the step keeps
// the probe concurrent with the other three checks rather than delaying every one of them.
async function build_gate_step(check: GateCheck, start_directory: string): Promise<GateStep> {
	if (check.label !== TYPE_CHECK_LABEL) {
		return { label: check.label, command_args: [JOSH, check.target] }
	}

	return {
		label: check.label,
		command_args: await type_check_step.resolve_type_check_args(start_directory),
	}
}

async function build_gate_steps(start_directory: string): Promise<ReadonlyArray<GateStep>> {
	return await Promise.all(
		GATE_CHECKS.map(async (check) => await build_gate_step(check, start_directory)),
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

function print_gate_step(result: GateStepResult, is_verbose: boolean): void {
	const icon = is_gate_step_failed(result) ? FAIL_ICON : PASS_ICON

	process.stdout.write(`\n${icon} ${result.label} (pnpm ${result.command})\n`)

	if (should_print_body(result, is_verbose) && result.output) {
		process.stdout.write(`${result.output}\n`)
	}
}

function print_gate_summary(failed_labels: ReadonlyArray<string>): void {
	if (failed_labels.length === 0) {
		process.stdout.write(`\n${PASS_ICON} verification gate passed (${STEP_COUNT} checks).\n`)

		return
	}

	process.stdout.write(`\n${FAIL_ICON} verification gate failed: ${failed_labels.join(', ')}\n`)
}

// The record `josh review:brief` reads, written only on a fully green run and only with the tree it
// was green on (joshuafolkken/kit#1241). `/code-review` runs in a forked process that reads none of
// this repository's documents, so "the unit tests already passed" reaches it only if the invocation
// carries it — and it may only carry it if something wrote down that they did, on **this** tree.
//
// **Three things withhold the record, and every one of them is the safe direction.** A step that
// passed *without running* — `test-unit-guard` exits 0 with a notice when vitest is absent or the
// project has no tests — must not become "the unit tests all passed": the gate keeps that skip
// visible on the console, and a record erasing it would have the brief tell a review agent not to
// re-run tests that never ran. A tree that moved while the checks were in flight (the `PostToolUse`
// formatter, an editor save) is not the tree they read. And a failed write leaves no record at all,
// which a temp-directory problem must never turn into a red gate.
//
// The destination is a parameter so a test can exercise the record without overwriting the one a
// real run may be relying on — `josh gate` and `josh review:brief` share one path by design.
async function record_green_gate(
	results: ReadonlyArray<GateStepResult>,
	before: Record<string, string>,
	target?: string,
): Promise<void> {
	if (results.some((result) => is_skip_notice(result))) return

	try {
		const after = await review_tree.read_changed_tree()

		if (JSON.stringify(after) !== JSON.stringify(before)) return

		review_stamps.gate_stamp.write(after, target)
	} catch {
		/* no record is the safe answer */
	}
}

// Results are printed in declaration order rather than completion order: a gate whose sections move
// around between runs cannot be read by scrolling to the same place twice.
// The tree is read **before** the checks start, so what the record claims is the tree they actually
// read rather than whatever the formatter left behind while they ran (joshuafolkken/kit#1241). A
// failure here is not the gate's business: no tree means no record, which the brief reports as
// "not verified".
async function read_tree_before_checks(): Promise<Record<string, string>> {
	try {
		return await review_tree.read_changed_tree()
	} catch {
		return {}
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

async function run_marked_gate_steps(
	before: Record<string, string>,
): Promise<ReadonlyArray<GateStepResult>> {
	return await with_gate_marker(before, async () => {
		const steps = await build_gate_steps(process.cwd())

		return await Promise.all(steps.map(async (step) => await run_gate_step(step)))
	})
}

async function run_verification_gate(is_verbose = false): Promise<number> {
	const before = await read_tree_before_checks()
	const results = await run_marked_gate_steps(before)

	for (const result of results) print_gate_step(result, is_verbose)

	const failed_labels = results
		.filter((result) => is_gate_step_failed(result))
		.map((result) => result.label)

	print_gate_summary(failed_labels)

	if (failed_labels.length > 0) return FAIL_EXIT_CODE

	await record_green_gate(results, before)

	return 0
}

// `josh gate` fans out to four sub-commands and forwards nothing to them, so an appended flag
// would vanish exactly the way it does behind an `sh -c` composite — a run that looks configured
// and is not. The composite guard only inspects `shell` entries, so a `script` entry that fans out
// has to refuse for itself; the message comes from that guard so the two read identically.
// `--verbose` is consumed here rather than forwarded, which is why it does not fall foul of the
// refusal above: the refusal exists because a forwarded flag vanishes into the sub-commands, and a
// flag the gate reads itself never reaches them. Every other argument is still refused.
const VERBOSE_FLAG = '--verbose'

async function run_gate_command(extra_arguments: ReadonlyArray<string>): Promise<number> {
	const is_verbose = extra_arguments.includes(VERBOSE_FLAG)
	const unknown = extra_arguments.filter((argument) => argument !== VERBOSE_FLAG)

	if (unknown.length > 0) {
		// The shared refusal, plus the arguments it is actually about. `--verbose` is accepted, so the
		// bare "takes no extra arguments" would send a reader to drop the one flag that works.
		process.stderr.write(
			`${composite_arguments.format_rejection(GATE_COMMAND, GATE_TARGETS)}\n` +
				`  refused: ${unknown.join(' ')}\n` +
				`  accepted here: ${VERBOSE_FLAG}\n`,
		)

		return USAGE_ERROR_EXIT_CODE
	}

	return await run_verification_gate(is_verbose)
}

// `process.exitCode` rather than `process.exit()`: the gate's output is buffered per step and
// written all at once, and `process.exit()` truncates a piped stdout at its buffer size — the
// summary, written last, is the first thing lost. Setting the code lets the writes drain and the
// process end on its own, which it can, since every child has already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_gate_command(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const verification_gate = {
	VERBOSE_FLAG,
	build_gate_step,
	build_gate_steps,
	clear_gate_running,
	is_gate_step_failed,
	mark_gate_running,
	record_green_gate,
	run_marked_gate_steps,
	with_gate_marker,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateStep, GateStepResult }
export { GATE_TARGETS, verification_gate }
