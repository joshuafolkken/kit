#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { buffered_process, FAIL_EXIT_CODE, type BufferedProcessResult } from './buffered-process'
import { GATE_COMMAND } from './josh/josh-command-types'
import { composite_arguments, USAGE_ERROR_EXIT_CODE } from './josh/josh-composite-arguments'
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

function print_gate_step(result: GateStepResult): void {
	const icon = is_gate_step_failed(result) ? FAIL_ICON : PASS_ICON

	process.stdout.write(`\n${icon} ${result.label} (pnpm ${result.command})\n`)
	if (result.output) process.stdout.write(`${result.output}\n`)
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
async function run_verification_gate(): Promise<number> {
	const steps = await build_gate_steps(process.cwd())
	const results = await Promise.all(steps.map(async (step) => await run_gate_step(step)))

	for (const result of results) print_gate_step(result)

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
async function run_gate_command(extra_arguments: ReadonlyArray<string>): Promise<number> {
	if (extra_arguments.length > 0) {
		process.stderr.write(`${composite_arguments.format_rejection(GATE_COMMAND, GATE_TARGETS)}\n`)

		return USAGE_ERROR_EXIT_CODE
	}

	return await run_verification_gate()
}

// `process.exitCode` rather than `process.exit()`: the gate's output is buffered per step and
// written all at once, and `process.exit()` truncates a piped stdout at its buffer size — the
// summary, written last, is the first thing lost. Setting the code lets the writes drain and the
// process end on its own, which it can, since every child has already exited by here.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run_gate_command(process.argv.slice(FIRST_ARGUMENT_INDEX))
}

const verification_gate = {
	build_gate_step,
	build_gate_steps,
	is_gate_step_failed,
	run_gate_command,
	run_gate_step,
	run_verification_gate,
}

export type { GateStep, GateStepResult }
export { GATE_TARGETS, verification_gate }
