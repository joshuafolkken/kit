import { josh_verdict } from '#scripts/josh-verdict'
import { status_icons } from '#scripts/status-icons'
import { z } from 'zod'

// Reading a josh check's failure out of what it printed, when the pipe threw its exit status away
// (joshuafolkken/kit#1361).
//
// joshuafolkken/kit#1309 records how a call came back from the harness's `is_error`, which reports
// the **tool call** rather than the command inside it. Agents call the verification gate through a
// pipe almost every time — `pnpm josh gate 2>&1 | tail -40` — and a pipeline exits with `tail`'s
// status, so a red gate is written back as a call that succeeded. Measured over this machine's kit
// transcripts for 2026-09-04 onward: 83 `josh gate` calls, 13 of them printing a failure line, and
// `is_error: true` on none of the 13. The rework figure #1309 exists to expose was therefore blind
// to exactly the re-runs that motivated it.
//
// **What is read is josh's own failure line, and only on a call that ran josh.** Every josh command
// that reports a per-item result opens the failing one with `status_icons.FAIL_ICON`, so a line
// beginning with that character in the output of a `pnpm josh <cmd>` call is that command saying it
// failed. The gate's is `✗ verification gate failed: lint (48.2s)`.
//
// **Refined by joshuafolkken/kit#1374**: a command that forwards another tool's output states its own
// verdict, and that verdict is read first — the bare icon is only consulted where there is none. See
// `verdict_answer` below and `josh-verdict.ts`.
//
// **Bounded on the other side by joshuafolkken/kit#1379**: that verdict silences the run it summarizes
// and not everything printed before it. The run begins at the gate's opening `plan:` line — printed
// once, before any check body exists — and never at a step header, which repeats per check. See
// `scan_line` here and `is_gate_opening` in `josh-verdict.ts`.
//
// **The outcome is only ever promoted, never lowered.** A call the harness already marked failed
// stays failed; this answers the two cases the harness got wrong — `ok`, which is the piped gate, and
// `unknown`, which is a tool that reports no outcome at all.
//
// ## The two candidates this was chosen over
//
// **A calling convention — never pipe the gate, or prefix `set -o pipefail`.** It is the only one of
// the three that leaves no measurement behind: a convention is obeyed or it is not, and the whole
// point of the figure is to catch what a run actually did rather than what it was supposed to do. It
// also answers nothing about the transcripts already written, which is where the evidence for any
// later change to the workflow has to come from.
//
// **A record written outside the transcript, joined by `josh time` afterwards** — the shape
// `review:brief` already reads the gate stamp in. It cannot be forgotten, which is its real
// advantage, and it is rejected on two counts rather than on the one the Issue names. A stamp carries
// no tool-call identity, so joining it to a span means matching on wall-clock time, which is a second
// heuristic in place of this one and a worse-behaved one under concurrency. And it measures only
// runs made after it ships: `josh time` reports on transcripts, including a session recorded weeks
// ago on another checkout, and a record that did not exist then leaves every one of those unchanged.
//
// **What this one costs, stated plainly.** It is coupled to josh's output format — narrowed to the
// commands whose format this repository owns, and pinned to the emitter's own constant so a rename
// breaks the build rather than the count. It is bounded on the other side too: a body the harness
// truncated, or saved to a file and replaced with a preview, may no longer carry the failure line, so
// the figure remains a floor. A smaller one than before, and for the first time it moves.

// A tool result's `content` is a string for most tools and a list of text blocks for the rest. Both
// shapes are read here rather than at the call site so `time-spans.ts` asks one question, not two.
//
// **The array is read element by element, not validated as a whole.** A zod array fails entirely if
// one element does not match, so a body holding a single block of some other shape would come back
// empty — and a genuinely red gate inside it would read as a success. That is the detector going
// quiet without failing, which is the failure mode this module's header argues against; per-element
// reading degrades to a floor instead.
const TEXT_BLOCK_SCHEMA = z.object({ text: z.string().nullish() })
const CONTENT_SCHEMA = z.union([z.string(), z.array(z.unknown())])

const LINE_SEPARATOR = '\n'

function block_text(block: unknown): string {
	const parsed = TEXT_BLOCK_SCHEMA.safeParse(block)

	return parsed.success ? (parsed.data.text ?? '') : ''
}

// Text that could not be read at all is empty rather than absent: nothing downstream distinguishes
// "no body" from "a body with no failure line", and both mean the same thing to the detector.
function result_text(content: unknown): string {
	const parsed = CONTENT_SCHEMA.safeParse(content)

	if (!parsed.success) return ''

	if (typeof parsed.data === 'string') return parsed.data

	return parsed.data.map((block) => block_text(block)).join(LINE_SEPARATOR)
}

// Leading whitespace is trimmed because the gate indents nothing but other josh commands do —
// `josh propagate` lists one consumer per indented row — and the icon is still what opens the line.
function is_failure_line(line: string): boolean {
	return line.trimStart().startsWith(status_icons.FAIL_ICON)
}

// **A command's own verdict outranks the lines it forwarded** (joshuafolkken/kit#1374). `josh gate`
// prints the body of a step that skipped or passed with warnings, and that body belongs to eslint,
// svelte-check, vitest or cspell — one of them opening a line with the failure icon would otherwise
// make a *green* gate a failed call, and charge the next gate run as rework. Where a verdict line is
// present it is the answer; `josh-verdict.ts` carries the reasoning and why the alternative — a
// per-command list of failure-line patterns — was rejected.
//
// **A `passed` verdict speaks only for the lines in front of it.** A body is not one command's: a
// chained `pnpm josh gate && pnpm josh health` is labelled by its first segment and carries both
// outputs, and `josh propagate` runs each consumer's gate with inherited stdio, so a consumer's green
// verdict lands above propagate's own `✗ <repo>` report. Discarding the icon reading for the whole
// body on the strength of one verdict would silence exactly those, which is the promotion this module
// exists to make going quiet without failing. A forwarded body is printed *before* the verdict that
// summarizes it, so what follows the last one belongs to whatever ran next and is still read.
//
// **And it speaks only for the run in front of it, not for everything printed earlier**
// (joshuafolkken/kit#1379). "Everything before the verdict" was one-sided: a call that runs a josh
// command stating no verdict and *then* a green gate — `pnpm josh propagate; pnpm josh gate` — is
// labelled by its first segment, and propagate's `✗ <repo>` rows were thrown away by a verdict printed
// by the command after them. The run a verdict summarizes begins at that gate's opening `plan:` line,
// so the silenced region is bounded on both sides.
function is_failed_verdict(line: string): boolean {
	return josh_verdict.read_verdict(line) === josh_verdict.FAILED_VERDICT
}

function is_passed_verdict(line: string): boolean {
	return josh_verdict.read_verdict(line) === josh_verdict.PASSED_VERDICT
}

// What one pass over the body has established. The two failure buckets are kept apart because a
// passed verdict answers them differently: it discards what the gate forwarded and keeps what was
// printed before the gate started.
interface FailureScan {
	did_find: boolean
	has_failure_before_region: boolean
	has_failure_in_region: boolean
	is_region_open: boolean
}

function new_scan(): FailureScan {
	return {
		did_find: false,
		has_failure_before_region: false,
		has_failure_in_region: false,
		is_region_open: false,
	}
}

// **The reading between the two is the whole fix, and the guard on it is the whole of its safety.**
// A failure mark printed before the region opened is confirmed here, because the gate had not started
// yet and the gate's opening line is printed before any body it could forward. One printed inside the
// region is discarded, which is what joshuafolkken/kit#1374 closed.
//
// **No opening line seen means no region, and then nothing is confirmed** — the pre-#1379 behavior
// exactly. That is the case a `2>&1 | tail -40` produces when the head of the gate's output falls off
// the top of the window, and reading the surviving body lines there would put #1374's false positive
// straight back. So the fix is bounded by what it can actually see, and where it cannot see, the
// figure stays the floor it already was.
function close_region(scan: FailureScan): void {
	scan.did_find ||= scan.is_region_open && scan.has_failure_before_region
	scan.has_failure_before_region = false
	scan.has_failure_in_region = false
	scan.is_region_open = false
}

function note_failure(scan: FailureScan): void {
	if (scan.is_region_open) {
		scan.has_failure_in_region = true

		return
	}

	scan.has_failure_before_region = true
}

// A gate step line opening with the failure icon is read as the gate's own failure rather than as
// anything about the region: it is the gate's report about one check, and the run it belongs to states
// a failed verdict of its own.
function scan_line(scan: FailureScan, line: string): void {
	if (is_passed_verdict(line)) {
		close_region(scan)

		return
	}

	if (is_failure_line(line)) {
		note_failure(scan)

		return
	}

	if (josh_verdict.is_gate_opening(line)) scan.is_region_open = true
}

function scan_body(lines: ReadonlyArray<string>): FailureScan {
	const scan = new_scan()

	for (const line of lines) scan_line(scan, line)

	return scan
}

// Nothing closed the last segment, so both buckets count — a body truncated past its verdict, and a
// command that states no verdict at all, are read exactly as they were before.
function did_scan_find(scan: FailureScan): boolean {
	return scan.did_find || scan.has_failure_before_region || scan.has_failure_in_region
}

// **Answered while the body is in hand, and reduced to one bit.** `time-spans.ts` parses a whole
// session before it aggregates anything, so a field holding each result's text would retain every
// byte the session's tools printed for the length of the parse — megabytes on an `epicrun`
// transcript, where before this the bodies were freed line by line.
//
// The bare-icon reading stays rather than being replaced: a josh command that prints no verdict of
// its own — `josh health`, and `josh propagate`, whose own report is a row per consumer — says it
// failed only in the line it printed, and so does a gate whose body was truncated past its verdict.
// The figure remains a floor.
function has_failure_line(content: unknown): boolean {
	const lines = result_text(content).split(LINE_SEPARATOR)

	if (lines.some((line) => is_failed_verdict(line))) return true

	return did_scan_find(scan_body(lines))
}

// **The josh guard is the whole of what keeps this from being a guess.** Any tool's output may
// contain that character for its own reasons; only a `pnpm josh <cmd>` call's output is written by
// this repository, and only there does the character mean what this reads it to mean.
function is_reported_failure(josh_command: string, did_print_failure: boolean): boolean {
	return josh_command !== '' && did_print_failure
}

const time_reported_failure = { result_text, has_failure_line, is_reported_failure }

export { time_reported_failure }
