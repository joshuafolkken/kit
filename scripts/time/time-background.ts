import { json_value } from '#scripts/json-value'
import { COMMAND_PHASES, type PhaseName } from './time-phase-names'
import { time_shell } from './time-shell'
import type { Span } from './time-spans'

// Where a backgrounded command's runtime sits on the timeline (joshuafolkken/kit#1662).
//
// **A span is the gap between two consecutive events, named by the later one** — `time-spans.ts`'s
// partition — so a command issued with `run_in_background` closes its span at the *launch's* own
// tool result, two or three seconds later. Everything the command then spends running is a
// different span, labelled by whatever call came next, and the join that reads its output minutes
// afterwards is a bare `tail` / `cat` with no `josh_command` at all. So `gate` and `pr` counted the
// launch call and nothing else: run #1597's `gate` read 4.4 s beside a last-8 median of 32.4 s,
// which is a foreground reading and a launch reading averaged together.
//
// **The transcript does record enough to place it, in two halves that have to be read at once.**
// The launch's result body says `Command running in background with ID: <id>`, and the call that
// later reads the output names `…/tasks/<id>.output` in its command string. Neither survives on its
// own: a span keeps no input and no body, so both are read at parse time and carried as fields, the
// same rule `marker`, `check_key` and `writes` already follow.
//
// **What is positioned is `own_duration_ms`, never `duration_ms`.** The four category shares
// reconstruct the elapsed time exactly, and that invariant is what makes two runs comparable — so
// the launch span keeps its share of the wall clock and gains the *length* of the command it
// started, which is precisely the distinction joshuafolkken/kit#1591 added the second field for.
//
// **The phase is what makes the minutes readable, and it is the existing precedence rather than a
// new one.** `time-phases.ts` already lets a command's own phase win over whichever window a span
// sits in, so the gate spans running beside a review are not charged to the review. A span sitting
// *inside* a backgrounded command's window and carrying no phase of its own is the same case one
// step further: it is time the run spent with that command outstanding. A span that does carry one —
// the review's `Skill` call above all — keeps it, so a run that genuinely overlapped its gate reports
// a small `gate` and a run that joined immediately reports the whole wait, which is the reading
// joshuafolkken/kit#1608 could not build while the span was the launch call.

const NO_BACKGROUND = ''

// The launch's own result body, which is the only place the harness writes the id it assigns. Read
// as a derived fact and the body discarded, exactly as `has_failure_line` and `followup_stages` are.
const LAUNCH_PATTERN = /running in background with ID:\s*([\w-]+)/iu
// The output file every reader of a backgrounded command names, whichever command it uses to read
// it — `tail`, `cat`, `sed`, `grep`, or the `Monitor` tool, all of which carry the path.
const OUTPUT_PATTERN = /tasks\/([\w-]+)\.output/u
// The other spelling of the same join. `BashOutput` takes the shell id in a field of its own rather
// than naming the output file, so a reader that matched only the path would classify every run
// joined that way as never read — reporting `background runtime not measured` for exactly the case
// this module exists to measure.
const BASH_ID_KEY = 'bash_id'

// **Quoted text is removed first, and here that is load-bearing rather than tidy.** This
// repository's issue and comment bodies quote command chains constantly, so a `gh api -f body="…
// tasks/x.output …"` would otherwise be read as the join of a background run it merely describes —
// the same hazard `time_shell.discarded_commands` removes the quotes for. **The direction of the
// error is deliberate**: a join written with the path in quotes is missed, and a missed reading is
// reported as not measured, while a false one silently closes a window at the wrong instant.
function read_id(command: string): string {
	return OUTPUT_PATTERN.exec(time_shell.unquoted(command))?.[1] ?? NO_BACKGROUND
}

// The id a call reads, from either spelling — the field where the tool carries one, the command
// string otherwise. Asked of the whole input rather than of the command, because only the input has
// the field.
function read_id_of(input: unknown): string {
	if (!json_value.is_record(input)) return NO_BACKGROUND

	const id = input[BASH_ID_KEY]

	return typeof id === 'string' ? id : read_id(time_shell.bash_command(input))
}

function launch_id(text: string): string {
	return LAUNCH_PATTERN.exec(text)?.[1] ?? NO_BACKGROUND
}

// One backgrounded command, from the instant it was launched to the instant its result was read.
//
// `is_read` is the fourth field rather than an `ended_ms` of `undefined`, because the two answers
// have to be told apart downstream: a launch nobody ever read is reported as not measured, and a
// sentinel instant would be indistinguishable from a run that really did close at that moment.
interface BackgroundRun {
	// The id the harness assigned, which is what a launch is matched back to its *own* run by. Placing
	// a launch by the window it merely sits inside gives it a second command's length the moment two
	// are outstanding at once.
	id: string
	josh_command: string
	started_ms: number
	ended_ms: number
	is_read: boolean
}

function started_ms(span: Span): number {
	return span.ended_ms - span.duration_ms
}

// The first call that reads this launch's output, or nothing. **The first, not the last**: a run
// reads one output file several times — the sample this was written from read it four times, a
// `tail` then three `grep`s — and every reading after the first is work done on a result already in
// hand rather than time spent waiting for it.
function read_end_ms(spans: ReadonlyArray<Span>, run: Span): number | undefined {
	const found = spans.find(
		(span) => span.reads_background === run.background_id && started_ms(span) >= run.ended_ms,
	)

	return found?.ended_ms
}

function to_run(spans: ReadonlyArray<Span>, launch: Span): BackgroundRun {
	const read = read_end_ms(spans, launch)

	return {
		id: launch.background_id,
		josh_command: launch.josh_command,
		started_ms: started_ms(launch),
		ended_ms: read ?? launch.ended_ms,
		is_read: read !== undefined,
	}
}

function is_launch(span: Span): boolean {
	return span.background_id !== NO_BACKGROUND
}

function runs(spans: ReadonlyArray<Span>): Array<BackgroundRun> {
	return spans.filter((span) => is_launch(span)).map((launch) => to_run(spans, launch))
}

// Half-open and decided by where a span *starts*, which is the test `time-phases.ts` uses for its own
// windows — so a span cannot be charged both to a background run and to the window it opens in.
function is_within(span: Span, run: BackgroundRun): boolean {
	const start = started_ms(span)

	return start >= run.started_ms && start < run.ended_ms
}

// **The most recently launched enclosing run, never the first the array happens to hold.** Two
// commands can be outstanding at once — `josh gate` started beside the review, then `josh git -y` —
// and a span between them was spent inside the one launched last. **Ordering by run *length* answers
// a different question**: the shorter of two overlapping runs is the inner one only where they
// happen to nest, so a span issued after the second launch would be charged to the first.
//
// Only a run that was read back is ordered here. One that was not has no window to enclose anything
// with, and its own launch is left exactly as the transcript recorded it.
function latest_first(all: ReadonlyArray<BackgroundRun>): Array<BackgroundRun> {
	return all
		.filter((run) => run.is_read)
		.toSorted((left, right) => right.started_ms - left.started_ms)
}

// **A launch is placed by the run it started, never by the window it sits in.** The two are the same
// thing only while one command is outstanding: launch a second inside the first's window, and an
// enclosing lookup hands the second launch the first command's length — the wrong number for both,
// and precisely the two-outstanding-commands case this module is written for.
function own_run(span: Span, ordered: ReadonlyArray<BackgroundRun>): BackgroundRun | undefined {
	return is_launch(span) ? ordered.find((run) => run.id === span.background_id) : undefined
}

// A launch keeps its own share of the wall clock and gains the length of what it started. Every other
// span in the window is stamped with the command it ran beside, which is what `time-phases.ts` reads.
function placed(span: Span, ordered: ReadonlyArray<BackgroundRun>): Span {
	const own = own_run(span, ordered)
	const run = own ?? ordered.find((one) => is_within(span, one))

	if (run === undefined) return span

	const beside = { ...span, background_command: run.josh_command }

	return own === undefined ? beside : { ...beside, own_duration_ms: own.ended_ms - own.started_ms }
}

// **The identity for a run that backgrounded nothing**, which is most sessions and every test written
// before this existed: no launch means no window, and the spans come back exactly as they went in
// rather than round-tripped through the stamping.
function positioned(spans: ReadonlyArray<Span>): Array<Span> {
	const all = runs(spans)

	if (all.length === 0) return [...spans]

	const ordered = latest_first(all)

	return spans.map((span) => placed(span, ordered))
}

// The phases whose backgrounded command was never read back, so nothing in the transcript says how
// long it ran. **Reported rather than counted**: the launch span's own seconds are a real interval
// and stay in the totals, but presenting them as the command's runtime is the confident zero
// `is_detected` already exists to prevent one row further up.
function unread_phases(spans: ReadonlyArray<Span>): Set<PhaseName> {
	const names = runs(spans)
		.filter((run) => !run.is_read)
		.map((run) => COMMAND_PHASES.get(run.josh_command))

	return new Set(names.filter((phase): phase is PhaseName => phase !== undefined))
}

const time_background = {
	NO_BACKGROUND,
	launch_id,
	read_id,
	read_id_of,
	runs,
	positioned,
	unread_phases,
}

export type { BackgroundRun }
export { time_background }
