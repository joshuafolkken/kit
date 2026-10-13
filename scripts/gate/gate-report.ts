import { GATE_COMMAND } from '#scripts/josh/josh-command-types'
import { josh_verdict } from '#scripts/josh/josh-verdict'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'
import { status_icons } from '#scripts/lib/status-icons'
import { NOTHING_TO_CHECK_MARKER } from '#scripts/test/skip-marker'
import { test_unit_guard } from '#scripts/test/test-unit-guard'
import { gate_log } from './gate-log'
import { gate_plan } from './gate-plan'

// The gate's console reporting, split out of `verification-gate.ts` so that file stays under its line
// ceiling while it grows the scoped pre-check and the failure summary. Nothing
// about what is printed changes in the move: the four blocks, the log notice and the verdict come out
// exactly as before, with one addition — the per-failure action lines below.

const { FAIL_ICON, PASS_ICON, WARN_ICON } = status_icons

interface GateStep {
	label: string
	command_args: ReadonlyArray<string>
	cwd?: string | undefined
	skip_reason?: string | undefined
}

interface GateStepResult extends BufferedProcessResult {
	label: string
	// What was actually run. The type check's command is resolved per project, so a failure on the
	// `check` step is only reproducible if the header names the command rather than the label.
	command: string
	// Set when the check started past the machine-wide budget at the wait cap.
	budget_note?: string | undefined
}

function is_gate_step_failed(result: GateStepResult): boolean {
	return buffered_process.is_process_failed(result)
}

// A passing check's output is not read. What a green gate has to say is "all four passed", and
// `print_gate_summary` already says it in one line — while the four bodies, vitest's per-file
// listing among them, run to tens of kilobytes that then sit in the conversation and are re-read on
// every later turn. The gate runs more than once per Issue, so the cost is per run, not per Issue.
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

// The withholding path's counterpart to `has_warnings`, and deliberately narrower than it.
// `has_warnings` is read by `should_print_body`, where a false positive
// costs one printed body — the loose match above is right there. `record_green_gate` reads *this*
// one, where a false positive is not one printed line but the whole green record withheld, which
// turns a green gate's `run:review --join` red. So the record is withheld only for a warning from a
// checker that actually emits per-tree warnings (`WARNING_CHECKER_LABELS`), never for a benign line
// from another tool that happens to contain the word — a Vite config deprecation on `test:unit` was
// the line that stopped a green gate's commit chain.
//
// **The safe-chain shim's banner is not the checker's either**. Where
// `setup-ci` installed the shims but the binary cannot be reached, every `pnpm` a check spawns prints
// "Warning: safe-chain is not available …" into that check's output, so a green lint withheld the
// record on every CI run. The banner's lines are dropped before the match; a real warning on any
// other line still withholds.
const SAFE_CHAIN_BANNER = 'safe-chain is not available'

function checker_lines(result: GateStepResult): ReadonlyArray<string> {
	return result.output.split('\n').filter((line) => !line.includes(SAFE_CHAIN_BANNER))
}

function has_checker_warning(result: GateStepResult): boolean {
	if (!gate_plan.WARNING_CHECKER_LABELS.includes(result.label)) return false

	return checker_lines(result).some((line) =>
		WARNING_MARKERS.some((marker) => line.includes(marker)),
	)
}

// **A check the verdict counts as skipped said nothing but that it checked nothing.** `is_skip_notice`
// asks whether a check carries a skip notice, which is the right question for printing its body and for
// withholding the green record; it is the wrong one for a count, twice over. A check can skip half of
// itself — a `basic` project's `lint` runs Prettier and skips eslint — and calling it skipped would
// have the verdict say nothing ran on a gate that checked the formatting. And a check can run with
// nothing of the project's to look at — `exports` in a consumer, `behavior` with no transcript — which
// is no skip, and still left an empty `basic` project reading `2 ran`. A line that is neither notice is
// something a tool printed, so the check ran. A tool that ran clean and silent beside a skipped one is
// given a line of its own by the check (`project_checks.ran_notice`), so the reading holds for it too.
//
// **pnpm's script header is not something the check printed.** Every check is spawned as
// `pnpm josh <target>`, and where the project declares a `josh` script — `josh init` writes one — pnpm
// opens the captured output with `$ josh <target>`. Counted as a line, it made every spawned check one
// that ran, and `not verified` unreachable in the very project it was written for.
const IDLE_MARKERS: ReadonlyArray<string> = [test_unit_guard.SKIP_MARKER, NOTHING_TO_CHECK_MARKER]
const PNPM_SCRIPT_HEADER = '$ '

function is_idle_line(line: string): boolean {
	return IDLE_MARKERS.some((marker) => line.includes(marker))
}

function is_tool_line(line: string): boolean {
	return line.trim() !== '' && !line.startsWith(PNPM_SCRIPT_HEADER)
}

function is_idle(result: GateStepResult): boolean {
	const lines = checker_lines(result).filter((line) => is_tool_line(line))

	return lines.length > 0 && lines.every((line) => is_idle_line(line))
}

function should_print_body(result: GateStepResult, is_verbose: boolean): boolean {
	if (is_verbose || is_gate_step_failed(result)) return true

	return is_skip_notice(result) || has_warnings(result)
}

// Seconds to one decimal, which is the resolution the answer is read at: the question a gate's
// timing answers is "which of the four is the long pole", and no check is ever separated from
// another by less than a tenth of a second.
const MS_PER_SECOND = 1000
const SECONDS_DECIMALS = 1

function format_seconds(elapsed_ms: number): string {
	return `${(elapsed_ms / MS_PER_SECOND).toFixed(SECONDS_DECIMALS)}s`
}

// The duration goes at the **end** of the header, after the command. The header's first job is
// naming the one command to re-run while fixing (`docs/josh-commands.md` → `josh gate`), and a
// number spliced in front of it would push that name out of the place a reader scans for it.
//
// Built rather than inlined because the log file names each section with the same string:
// a header written twice is a header the two copies can disagree about,
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
// the verdict**. A red gate used to report every failing check only in its
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

// **A check that started past the core budget is said in the summary, not only in the log**.
// The wait cap admits a check that waited two minutes whatever the budget says,
// so a gate that ran over-subscribed would otherwise look exactly like one that fitted.
function format_budget_notes(results: ReadonlyArray<GateStepResult>): string {
	const lines = results.flatMap((result) =>
		result.budget_note === undefined
			? []
			: `  ${WARN_ICON} ${result.label} — ${result.budget_note}`,
	)

	return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

// **The verdict counts what ran apart from what was skipped, and a gate that ran nothing does not say
// `passed`.** It printed the planned number of checks whatever happened to them, so a `basic` project
// whose every check skipped read `passed (6 checks)` — the same last line as a gate that ran them all,
// and the skip this module keeps visible in the bodies was invisible in the one line a `tail` keeps.
//
// **A gate with no skip keeps the line it always printed.** A check with nothing to check is counted
// apart only beside a skip: `exports` says so in every consumer, and counting it alone would reword the
// verdict of every gate that skipped nothing.
function format_green_verdict(results: ReadonlyArray<GateStepResult>, total: string): string {
	const has_skip = results.some((result) => is_skip_notice(result))
	const skipped = has_skip ? results.filter((result) => is_idle(result)).length : 0
	const ran = results.length - skipped

	if (ran === 0) return josh_verdict.format_gate_unverified(skipped, total)

	return josh_verdict.format_gate_passed({ ran, skipped }, total)
}

// The total is wall-clock for the whole command, not the sum of the four — they run concurrently,
// so a sum would report about three times what the caller waited.
//
// The failure actions and the log path are printed with the summary and immediately **above** the
// verdict line, which stays last for the reason `josh-verdict.ts` gives.
function print_gate_summary(
	results: ReadonlyArray<GateStepResult>,
	report: GateReport,
	log_path?: string,
): void {
	const failed = results.filter((result) => is_gate_step_failed(result))
	const total = format_seconds(report.elapsed_ms)
	const verdict =
		failed.length === 0
			? format_green_verdict(results, total)
			: josh_verdict.format_gate_failed(failed.map((result) => result.label).join(', '), total)
	const notes = format_budget_notes(results)

	process.stdout.write(
		`\n${notes}${format_failure_actions(failed)}${gate_log.format_log_notice(log_path)}${verdict}\n`,
	)
}

interface GateReport {
	is_verbose: boolean
	log_path: string | undefined
	elapsed_ms: number
}

// Everything a finished run says, in the order a reader meets it: the four blocks, then the log the
// blocks may have been elided out of, then the failure actions and the verdict. **Every check's whole
// output goes into the log, the ones the console dropped included**.
function report_gate_steps(
	results: ReadonlyArray<GateStepResult>,
	report: GateReport,
): ReadonlyArray<string> {
	for (const result of results) print_gate_step(result, report.is_verbose)

	const entries = results.map((result) => ({
		header: gate_step_header(result),
		output: result.output,
	}))
	const written_log = gate_log.write_gate_log(entries, report.log_path)

	print_gate_summary(results, report, written_log)

	return results.filter((result) => is_gate_step_failed(result)).map((result) => result.label)
}

const gate_report = {
	format_budget_notes,
	format_failure_actions,
	has_checker_warning,
	is_gate_step_failed,
	is_skip_notice,
	report_gate_steps,
}

export type { GateReport, GateStep, GateStepResult }
export { gate_report }
