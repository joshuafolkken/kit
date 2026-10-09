import { json_value } from '#scripts/lib/json-value'
import { COMMAND_PHASES, type PhaseName } from './time-phase-names'
import { time_shell } from './time-shell'
import type { Span } from './time-spans'

// Where a backgrounded command's runtime sits on the timeline.
//
// **A span is the gap between two consecutive events, named by the later one** — `time-spans.ts`'s
// partition — so a command issued with `run_in_background` closes its span at the *launch's* own
// tool result, two or three seconds later. Everything the command then spends running is a
// different span, labelled by whatever call came next, and the join that reads its output minutes
// afterwards is a bare `tail` / `cat` with no `josh_command` at all. So `gate` and `pr` counted the
// launch call and nothing else: one run's `gate` read 4.4 s beside a last-8 median of 32.4 s,
// which is a foreground reading and a launch reading averaged together.
//
// **The transcript does record enough to place it, in three halves that have to be read at once.**
// The launch's result body says `Command running in background with ID: <id>`; the call that later
// reads the output names `…/tasks/<id>.output` in its command string, or carries the shell id in a
// field; and the task-notification line the harness writes when the command ends names the same id in
// `<task-id>`. None survives on its own: a span keeps no input and no body,
// so all three are read at parse time and carried as fields, the same rule `marker`, `check_key` and
// `writes` already follow.
//
// **The third is what tells a join from a progress poll.** Closing the window at the first call that
// read the output at all would be wrong, because `BashOutput` is the tool a run *polls* with: a poll
// thirty seconds into an eight-minute gate would close the window and, worse, mark it measured.
//
// **What is positioned is `own_duration_ms`, never `duration_ms`.** The four category shares
// reconstruct the elapsed time exactly, and that invariant is what makes two runs comparable — so
// the launch span keeps its share of the wall clock and gains the *length* of the command it
// started, which is precisely the distinction the second field exists for.
//
// **The phase is what makes the minutes readable, and it is the existing precedence rather than a
// new one.** `time-phases.ts` already lets a command's own phase win over whichever window a span
// sits in, so the gate spans running beside a review are not charged to the review. A span sitting
// *inside* a backgrounded command's window and carrying no phase of its own is the same case one
// step further: it is time the run spent with that command outstanding. A span that does carry one —
// the review's `Skill` call above all — keeps it, so a run that genuinely overlapped its gate reports
// a small `gate` and a run that joined immediately reports the whole wait.

const NO_BACKGROUND = ''
// No notice said this command had finished, which is a different fact from finishing at instant zero:
// the window then has no reading that can be known to have seen the end, and the run is reported as
// not measured rather than closed at whichever call happened to look first.
const NO_FINISH = 0

// The launch's own result body, which is the only place the harness writes the id it assigns. Read
// as a derived fact and the body discarded, exactly as `has_failure_line` and `followup_stages` are.
// **A foreground call that outran its timeout is a launch too**: the harness
// moves it to the background and says so as `moved to the background (ID: <id>)`. Missing that spelling
// let the #3273 lane child end its turn on a running task the stop hook never saw.
const LAUNCH_PATTERN =
	/(?:running in background with ID:|moved to the background \(ID:)\s*([\w-]+)/iu
// A backgrounded subagent's launch result, which names its id on an `agentId:` line of its own.
const AGENT_LAUNCH_PATTERN = /^Async agent launched[\s\S]*?\bagentId:\s*([\w-]+)/u
// The notice the harness writes when a task it took into the background ends.
// It is anchored at the start because the whole content of that line *is*
// the notice — a body merely quoting one is text, the same hazard `read_id` unquotes for — and it
// keys on `<task-id>`, which the harness fills with the very id the launch's own body announced, so
// the pairing needs no second key and no lookup through the call id.
//
// **The status is deliberately not read.** A task-notification is written when the task ends; the
// status says *how* it ended — `completed`, `failed`, `killed` and `stopped` were all observed, and
// every one of them means the command is no longer running. Branching on the word would mean keeping
// an enumeration of the harness's spellings, and a spelling it added later would silently start
// reporting finished commands as never finished.
const FINISH_PATTERN = /^<task-notification>[\s\S]*?<task-id>([\w-]+)<\/task-id>/u
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

// The id of a subagent the harness took into the background. Its end is the
// same `<task-id>` notice a command's is, so `finished_id` pairs it unchanged. It is kept apart from
// `launch_id` on purpose: a subagent is not a command, and folding it in would open a timeline window
// that re-stamps the spans a backgrounded gate running beside the review is owed.
function agent_launch_id(text: string): string {
	return AGENT_LAUNCH_PATTERN.exec(text)?.[1] ?? NO_BACKGROUND
}

// The background run a task-notification line reports the end of, or nothing for every other line —
// which is nearly all of them, since only one line kind in a transcript carries this notice.
function finished_id(text: string): string {
	return FINISH_PATTERN.exec(text)?.[1] ?? NO_BACKGROUND
}

// One line, as much of it as this reading needs. Taken structurally rather than as a `TranscriptLine`
// so the import stays one-way: `time-transcript-line.ts` already imports this module to read the two
// ids off a body, and asking for its type back would close the cycle.
interface FinishNotice {
	finished_background: string
	timestamp_ms: number
}

// When the harness said each backgrounded command finished, keyed by the id it assigned.
//
// **The earliest instant for an id wins, and that is what makes the answer the *end* of the task.**
// One notice reaches the transcript on three line kinds at three different moments — generated,
// delivered, consumed — and a run resumed under the same id notifies again later still. The first of
// those is when the command stopped running; every later one is when something got round to it.
// Sorted latest first so the earliest entry is the *last* one written for its key, which is the one a
// `Map` built from pairs keeps. The sort is over the notices alone, which is a handful of lines in a
// transcript of thousands.
function finished_at(lines: ReadonlyArray<FinishNotice>): Map<string, number> {
	const notices = lines
		.filter((one) => one.finished_background !== NO_BACKGROUND)
		.toSorted((left, right) => right.timestamp_ms - left.timestamp_ms)

	return new Map(notices.map((one) => [one.finished_background, one.timestamp_ms]))
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

// The first call that read this launch's output **after the harness said the command had finished**,
// or nothing.
//
// **The first of those, not the last**: a run reads one output file several times — the sample this
// was written from read it four times, a `tail` then three `grep`s — and every reading after the
// first is work done on a result already in hand rather than time spent waiting for it. Extending the
// window to the last reading was weighed and refused for exactly that: it would charge the command
// with every `grep` a run made of a result it already held.
//
// **And not merely the first reading of any kind.** `BashOutput` is the tool a run polls progress
// with, so a poll thirty seconds in would close the window on a gate that ran eight minutes — and
// close it *confidently*, because `is_read` would then say the runtime had been measured and no
// `background runtime not measured` note would be emitted.
//
// **A launch no notice named is unread**, rather than falling back to the first reading. The
// direction of the error is the one this module already takes for a join written inside quotes: a
// missed reading is reported as not measured, while a wrong instant is reported as a measurement.
//
// **A reading qualifies by where it *ends*, never by where it starts.** The two differ for the one
// join shape this repository recommends: a blocking wait — an `until grep -q … <output>` loop, or the
// `Monitor` until-loop the Bash tool directs a run to, since foreground `sleep` is refused — is issued
// *before* the command finishes and returns *after* it. Tested by its start it would be discarded, and
// a run whose only join was that shape would report `background runtime not measured` — the very
// regression this module exists to remove. Measured over this checkout's transcripts, 32 of 345
// launches have readings that all begin before the notice, and the blocking wait is why. **The poll
// is still rejected**, because a thirty-second look at an eight-minute gate both begins and ends long
// before the notice; and a poll straddling the notice closes the window within seconds of the true
// end, which is the answer rather than an error.
function read_end_ms(spans: ReadonlyArray<Span>, run: Span): number | undefined {
	if (run.background_ended_ms === NO_FINISH) return undefined

	const found = spans.find(
		(span) =>
			span.reads_background === run.background_id && span.ended_ms >= run.background_ended_ms,
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
//
// **It searches every run, not only the ones read back.** An unread launch resolves to its own run
// too — one whose `ended_ms` is the launch's own, so nothing is widened — and that is what keeps it
// out of the enclosing branch below. Searched over the read runs alone it would fall through and be
// stamped with a *different* command, which `time-phases.ts` would then charge its minutes to.
function own_run(span: Span, all: ReadonlyArray<BackgroundRun>): BackgroundRun | undefined {
	return is_launch(span) ? all.find((run) => run.id === span.background_id) : undefined
}

// A launch keeps its own share of the wall clock and gains the length of what it started. Every other
// span in the window is stamped with the command it ran beside, which is what `time-phases.ts` reads.
function placed(
	span: Span,
	all: ReadonlyArray<BackgroundRun>,
	ordered: ReadonlyArray<BackgroundRun>,
): Span {
	const own = own_run(span, all)
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

	return spans.map((span) => placed(span, all, ordered))
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
	NO_FINISH,
	launch_id,
	agent_launch_id,
	finished_id,
	finished_at,
	read_id,
	read_id_of,
	runs,
	positioned,
	unread_phases,
}

export { time_background }
