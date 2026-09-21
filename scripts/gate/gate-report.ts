import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { josh_verdict } from '#scripts/josh/josh-verdict'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { status_icons } from '#scripts/lib/status-icons'
import { test_unit_guard } from '#scripts/test/test-unit-guard'
import { gate_log } from './gate-log'

// The gate's console reporting, split out of `verification-gate.ts` so that file stays under its line
// ceiling while it grows the scoped pre-check and the failure summary (joshuafolkken/kit#2296). Nothing
// about what is printed changes in the move: the four blocks, the log notice and the verdict come out
// exactly as before, with one addition — the per-failure action lines below.

const { FAIL_ICON, PASS_ICON } = status_icons

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
// absent, and suppressing that made a gate which ran zero tests print the same five lines as one
// that ran them all. The marker comes from the guard itself rather than being matched by eye, so
// the two cannot drift apart.
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
//
// Built rather than inlined because the log file names each section with the same string
// (joshuafolkken/kit#1227): a header written twice is a header the two copies can disagree about,
// and the log exists precisely to be read when the console's copy has been elided.
function gate_step_header(result: GateStepResult): string {
	const icon = is_gate_step_failed(result) ? FAIL_ICON : PASS_ICON

	return `${icon} ${result.label} (pnpm ${result.command}) ${format_seconds(result.elapsed_ms)}`
}

function print_gate_step(result: GateStepResult, is_verbose: boolean): void {
	process.stdout.write(`\n${gate_step_header(result)}\n`)

	if (should_print_body(result, is_verbose) && result.output) {
		process.stdout.write(`${result.output}\n`)
	}
}

// **One line per failed check, naming the command that reproduces it, printed at the tail just above
// the verdict** (joshuafolkken/kit#2296). A red gate used to report every failing check only in its
// bodies, which is where truncation lands: the run picked one failure at a time across separate gate
// runs because it could not read the rest. The verdict names *which* checks failed; this names *what
// to run* for each, and it sits in the same tail window the verdict and the log notice already
// occupy, so a `tail -40` keeps it. The verdict stays the last line for the reason `josh-verdict.ts`
// gives.
function format_failure_actions(failed: ReadonlyArray<GateStepResult>): string {
	if (failed.length === 0) return ''

	const lines = failed.map(
		(result) => `  ${FAIL_ICON} ${result.label} — re-run: pnpm ${result.command}`,
	)

	return `${GATE_COMMAND} — next:\n${lines.join('\n')}\n`
}

// The total is wall-clock for the whole command, not the sum of the four — they run concurrently,
// so a sum would report about three times what the caller waited.
//
// The failure actions and the log path are printed with the summary and immediately **above** the
// verdict line, which stays last for the reason `josh-verdict.ts` gives (joshuafolkken/kit#1227).
function print_gate_summary(
	failed: ReadonlyArray<GateStepResult>,
	elapsed_ms: number,
	step_count: string,
	log_path?: string,
): void {
	const total = format_seconds(elapsed_ms)
	const verdict =
		failed.length === 0
			? josh_verdict.format_gate_passed(step_count, total)
			: josh_verdict.format_gate_failed(failed.map((result) => result.label).join(', '), total)

	process.stdout.write(
		`\n${format_failure_actions(failed)}${gate_log.format_log_notice(log_path)}${verdict}\n`,
	)
}

interface GateReport {
	is_verbose: boolean
	log_path: string | undefined
	elapsed_ms: number
	step_count: string
}

// Everything a finished run says, in the order a reader meets it: the four blocks, then the log the
// blocks may have been elided out of, then the failure actions and the verdict. **Every check's whole
// output goes into the log, the ones the console dropped included** (joshuafolkken/kit#967).
function report_gate_steps(
	results: ReadonlyArray<GateStepResult>,
	report: GateReport,
): ReadonlyArray<string> {
	for (const result of results) print_gate_step(result, report.is_verbose)

	const entries = results.map((result) => ({
		header: gate_step_header(result),
		output: result.output,
	}))
	const failed = results.filter((result) => is_gate_step_failed(result))
	const written_log = gate_log.write_gate_log(entries, report.log_path)

	print_gate_summary(failed, report.elapsed_ms, report.step_count, written_log)

	return failed.map((result) => result.label)
}

const gate_report = {
	format_failure_actions,
	format_seconds,
	gate_step_header,
	has_warnings,
	is_gate_step_failed,
	is_skip_notice,
	print_gate_step,
	print_gate_summary,
	report_gate_steps,
	should_print_body,
}

export type { GateReport, GateStep, GateStepResult }
export { gate_report }
