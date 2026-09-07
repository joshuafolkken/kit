import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { eval_report, type MergeVerdict } from './eval-report'

// How many runs in a row have ended without measuring anything (joshuafolkken/kit#1197).
//
// A single non-measurement is reported and correctly does not block — but nothing was watching the
// *sequence*, so a suite that measured nothing three runs running printed three lines that each read
// as a one-off and scrolled past. The gate then stood open for as long as the connection stayed
// down, which is the whole failure mode: every run paid for its sessions and none of them said the
// rules still held.
//
// The record is one small file in the temp directory, on `#scripts/josh/stamp-file` — its path, its
// symlink defense and its ownership check are load-bearing and already single-sourced, so a second
// copy of them here is the clone `CLAUDE.md` prohibits. What this module keeps is the payload and
// the question asked of it, exactly as `eval-stamp.ts` does.
//
// **Keyed on `PACKAGE_DIR`, the same root `eval-stamp.ts` uses, and for the same reason**: the suite
// measures the kit package's own documents, so the run of verdicts is about that package rather than
// about whichever project invoked it. Under a global install one `PACKAGE_DIR` serves every project
// on the machine (joshuafolkken/kit#1215), and that is the wanted behavior here — the scenarios and
// the connection they need are shared, so a run that held in one project really did measure the
// documents the next one would have measured.

const STREAK_PREFIX = 'josh-eval-streak-'
// Three, because that is the number the Issue was written about: two in a row is a bad afternoon,
// three is a connection nobody is going to notice on their own.
const STREAK_ALARM = 3

const STREAK_SCHEMA = z.strictObject({
	verdict: z.string(),
	count: z.int().positive(),
})

type Streak = z.infer<typeof STREAK_SCHEMA>

function streak_path(): string {
	return stamp_file.stamp_path(STREAK_PREFIX)
}

// A record that cannot be read is no record. The count is an aid to noticing rather than a gate, so
// every failure here reads as "start again from one" instead of ending the run that just measured.
function parse_streak(text: string): Streak | undefined {
	try {
		return STREAK_SCHEMA.parse(JSON.parse(text))
	} catch {
		return undefined
	}
}

function read_streak(source: string = streak_path()): Streak | undefined {
	const text = stamp_file.read_stamp_text(source)

	return text === undefined ? undefined : parse_streak(text)
}

// A different verdict starts a new run of them rather than continuing the old one: `unmeasured` three
// times is one thing to notice and `unmeasured`, `blocked`, `unmeasured` is another, and counting
// them together would announce a connection problem to somebody whose scenario simply failed.
function next_streak(previous: Streak | undefined, verdict: MergeVerdict): Streak {
	const carried = previous?.verdict === verdict ? previous.count : 0

	return { verdict, count: carried + 1 }
}

// Best-effort, the same judgement `record_measured_tree` already makes: a temp-directory problem must
// not cost a measurement that has already been paid for in real Claude sessions.
function store(target: string, streak: Streak): void {
	try {
		stamp_file.write_stamp(target, streak)
	} catch (error) {
		console.error(`Could not record the run of verdicts: ${String(error)}`)
	}
}

function record(verdict: MergeVerdict, target: string = streak_path()): Streak {
	const streak = next_streak(read_streak(target), verdict)

	store(target, streak)

	return streak
}

// **Only the two verdicts that measured nothing.** `held` needs no warning, and neither does
// `blocked`, which is the opposite state: the rules *were* measured, one of them failed, and it
// already stops the merge on its own. Warning there would tell somebody iterating on a genuinely red
// scenario that their measurement never happened, which is false and points them away from the
// failure they are working on.
const SILENT_VERDICTS: ReadonlySet<string> = new Set([
	eval_report.VERDICT_HELD,
	eval_report.VERDICT_BLOCKED,
])

// Nothing is said about a single non-measurement either — that line is already printed and already
// correct. What earns a sentence is the run of them, and it says the number, because "three runs in
// a row" is the fact that turns a line worth scrolling past into one worth acting on.
function streak_warning(streak: Streak): string | undefined {
	if (SILENT_VERDICTS.has(streak.verdict) || streak.count < STREAK_ALARM) return undefined

	return `Warning: ${String(streak.count)} runs in a row have ended \`${streak.verdict}\`, so the rules have not been measured since before them. Fix that before trusting the gate.`
}

function report_streak(verdict: MergeVerdict, target: string = streak_path()): string | undefined {
	const warning = streak_warning(record(verdict, target))

	if (warning !== undefined) console.error(warning)

	return warning
}

const eval_streak = {
	next_streak,
	read_streak,
	record,
	report_streak,
	STREAK_ALARM,
	streak_path,
	streak_warning,
}

export { eval_streak }
export type { Streak }
