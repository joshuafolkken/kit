import { status_icons } from './status-icons'

// A josh command's own overall verdict, and the one place its line is written (joshuafolkken/kit#1374).
//
// `status-icons.ts` single-sourced the *character* a failure line opens with, which was enough while
// the only thing reading it was `time-reported-failure.ts` asking "did this call print a failure?".
// It is not enough for a command that **forwards another tool's output**. `josh gate` prints the body
// of a step that passed with warnings or skipped (joshuafolkken/kit#1328), and that body is written by
// eslint, svelte-check, vitest or cspell — this repository owns none of those formats. One of them
// opening a line with the failure icon makes a *green* gate read as a failed call, and the re-run that
// follows it is then charged as rework: the very figure joshuafolkken/kit#1361 exists to make honest.
//
// **The anchor is the command's own verdict, not the shape of every line it prints.** A command that
// forwards other tools' output states its own result in one line, and that line outranks the body it
// summarizes. **It outranks that body and nothing further**: one tool call's output is not one
// command's — a chained `pnpm josh gate && pnpm josh health` carries both, and `josh propagate` runs
// each consumer's gate with inherited stdio — so a `passed` verdict speaks for the lines in front of
// it and the reading resumes after it (`time-reported-failure.ts` → `lines_after_last_pass`).
//
// **Why not enumerate every josh failure-line shape.** That is the candidate joshuafolkken/kit#1374
// names as most likely, and rejects for the reason it names: the gate's step line is
// `✗ <label> (pnpm <cmd>) <n>s`, `josh health`'s is `  ✗ <label>` and `josh propagate`'s is
// `  ✗ <repo>  <reason>`, so a pattern list tight enough to exclude a third-party warning is a list of
// per-command patterns — and the next josh command to print a failure line is silently not counted,
// which is the detector going quiet without failing. Reading the verdict instead leaves every other
// josh command exactly as it was: no verdict line, so nothing changes for them.
//
// **What it degrades to is today's behavior, not silence.** A body the harness truncated past the
// verdict line falls back to the bare-icon reading, so the figure stays a floor. The gate's verdict is
// its **last** line, which is what survives the `2>&1 | tail -40` agents actually type
// (`prompts/collaboration-workflow/output-bounds.md`), so the fallback is the rare case rather than
// the common one.
//
// **The opening line is here for the same reason the verdict is** (joshuafolkken/kit#1379). A verdict
// says where the gate's output *ended*; nothing said where it began, so a green verdict silenced every
// failure mark printed before it — including one written by a command that had already finished. The
// gate's plan line is what says "the gate starts here", and it is single-sourced for the reason the
// verdict is: the printer builds it and the detector matches it from one place.

const { FAIL_ICON, PASS_ICON } = status_icons
const GATE_SUBJECT = 'verification gate'

// The prefixes are what the detector matches **and** what the printer builds its line from, so a
// reworded verdict moves both ends at once — the property joshuafolkken/kit#1361 gave the icon,
// applied to the line. Splitting them into a printed string and a matched string is exactly the drift
// this module exists to prevent.
const GATE_PASSED_PREFIX = `${PASS_ICON} ${GATE_SUBJECT} passed`
const GATE_FAILED_PREFIX = `${FAIL_ICON} ${GATE_SUBJECT} failed`

type JoshVerdict = 'passed' | 'failed'

// Typed rather than left to inference: the namespace object widens a bare literal to `string`, and a
// caller comparing `read_verdict(line)` against it would then be comparing two unrelated types.
const PASSED_VERDICT: JoshVerdict = 'passed'
const FAILED_VERDICT: JoshVerdict = 'failed'

function format_gate_passed(step_count: string, total: string): string {
	return `${GATE_PASSED_PREFIX} (${step_count} checks) in ${total}.`
}

function format_gate_failed(failed_labels: string, total: string): string {
	return `${GATE_FAILED_PREFIX}: ${failed_labels} (${total})`
}

// The gate's opening line — `plan: 4 of 4 checks at once, unit at 7 workers (10 cores)` — split into
// the two fragments the matcher tests for, so the printed line and the test for it move together the
// way the verdict's prefixes already do. `gate-plan.ts` builds the line from these.
//
// **It is the opening line and not a step header, and the difference is the whole safety of the
// bound.** A step header repeats once per check, so a body long enough to push the first header off
// the top of a `tail -40` window leaves later headers behind it — and a forwarded `✗` would then sit
// *before* a header and be read as printed before the gate started, which is #1374's false positive
// returning. The plan line is printed once, before any check body exists, so nothing the gate forwards
// can ever precede it.
const GATE_OPENING_PREFIX = 'plan: '
const GATE_OPENING_MARK = ' checks at once'

// **Deliberately narrow, and wrong in the safe direction if it is wrong.** Both fragments are required
// rather than either alone: a missed opening costs the pre-#1379 behavior — the whole prefix stays
// silenced and the figure stays the floor it already was — while a false one would let a forwarded
// line be read.
function is_gate_opening(line: string): boolean {
	const trimmed = line.trimStart()

	return trimmed.startsWith(GATE_OPENING_PREFIX) && trimmed.includes(GATE_OPENING_MARK)
}

// Leading whitespace is trimmed for the same reason `time-reported-failure.ts` trims it: a caller that
// quoted the body into an indented block still printed the verdict.
function read_verdict(line: string): JoshVerdict | undefined {
	const trimmed = line.trimStart()

	if (trimmed.startsWith(GATE_FAILED_PREFIX)) return FAILED_VERDICT

	if (trimmed.startsWith(GATE_PASSED_PREFIX)) return PASSED_VERDICT

	return undefined
}

const josh_verdict = {
	PASSED_VERDICT,
	FAILED_VERDICT,
	format_gate_passed,
	format_gate_failed,
	GATE_OPENING_MARK,
	GATE_OPENING_PREFIX,
	is_gate_opening,
	read_verdict,
}

export type { JoshVerdict }
export { josh_verdict }
