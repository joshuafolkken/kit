#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { buffered_process, FAIL_EXIT_CODE, type BufferedProcessResult } from './buffered-process'
import { GATE_COMMAND } from './josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh/josh-composite-arguments'
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

// Results are printed in declaration order rather than completion order: a gate whose sections move
// around between runs cannot be read by scrolling to the same place twice.
async function run_verification_gate(is_verbose = false): Promise<number> {
	const steps = await build_gate_steps(process.cwd())
	const results = await Promise.all(steps.map(async (step) => await run_gate_step(step)))

	for (const result of results) print_gate_step(result, is_verbose)

	const failed_labels = results
		.filter((result) => is_gate_step_failed(result))
		.map((result) => result.label)

	print_gate_summary(failed_labels)

	return failed_labels.length > 0 ? FAIL_EXIT_CODE : 0
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
	is_gate_step_failed,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateStep, GateStepResult }
export { GATE_TARGETS, verification_gate }
