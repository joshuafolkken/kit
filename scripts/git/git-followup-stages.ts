import { time_format } from '#scripts/time/time-format'

// Where `pnpm josh followup` spends its own wall clock (joshuafolkken/kit#1349).
//
// joshuafolkken/kit#1333 removed 19 seconds of dead air between reading a clean review and issuing
// the merge, and left the next stretch of the same 134 seconds unexamined: the **44 seconds
// `followup --merge` spends on itself**. One invocation does nine things in order — the `closes #N`
// check, the three GitHub reads the notification needs, the required-check wait, the CodeRabbit line
// comments, the AI reviewers' top-level comments, the completion Telegram, the merge request, the
// completion comment and the epic auto-close — and not one of them had ever been timed. So every
// proposal to shorten it was a guess, and a guess made under time pressure falls on whichever stretch
// is easiest to cut rather than on the one that is long: the notification and the auto-close, which is
// exactly where the merge gate lives.
//
// **Laps, not a wrapper per stage.** The alternative was a `measure(name, () => …)` closure around
// each call, which reads well and rewrites every call site in the file it instruments — nine
// reformatted call sites in a file already at 260 of its 300 code lines. A lap records the interval
// since the previous mark, so instrumenting a stage is one line after it and the call itself is
// untouched. What it gives up is the stage still in flight when something throws, and
// `INTERRUPTED_STAGE` is how that is paid for rather than lost: the caller marks one final lap on the
// way out, so the failing stage's duration — the one a reader wants most — is still printed.
//
// **The printed line is the interface, and its prefix is single-sourced for the reason
// `status-icons.ts` single-sources its icon.** `josh time` reads what a josh command printed out of
// the transcript's tool result (`time-reported-failure.ts`), which is the only way anything can see
// inside a single Bash span — and a reader matching a string the printer is free to reword is a reader
// that goes quiet without failing. So the prefix is declared here and the printer builds its lines
// from it, which is what lets a reader be added later without matching a reworded string. **No reader
// exists yet** — `josh time` reports a `followup` span as a whole — and saying so is the point: the
// constant is preparation, not an integration.
//
// **Seconds come from `time_format`** rather than from a private formatter. `verification-gate.ts`
// already has one of its own (`48.2s`), and a third spelling of "how long did this take" in a
// repository whose own report reads these lines is the clone `CLAUDE.md` prohibits.

const STAGE_LINE_PREFIX = 'followup stage: '
const STAGE_TOTAL_PREFIX = 'followup stages total: '
// Wide enough for the longest name below, so the durations line up in one column without the reader
// having to count. Parsing is unaffected: the fields are whitespace-separated either way.
const STAGE_NAME_WIDTH = 20
// Where the duration column starts, so the total lands under the stage durations rather than beside
// the label. Derived from the two constants above instead of written out, which is what keeps the
// block aligned when a longer stage name widens it.
const VALUE_COLUMN = STAGE_LINE_PREFIX.length + STAGE_NAME_WIDTH
const NO_DURATION = 0

// The stages, named once. They are the units a proposal to shorten `followup` would be written
// against, so a rename has to move the printer and whatever reads it together.
const STAGE = {
	closes_check: 'closes-check',
	context: 'context',
	checks_wait: 'checks-wait',
	coderabbit_comments: 'coderabbit-comments',
	ai_review_comments: 'ai-review-comments',
	telegram: 'telegram',
	merge: 'merge',
	completion_comment: 'completion-comment',
	epic_close: 'epic-close',
	// The lap that was still running when a stage threw. `followup` exits non-zero on an AI-review
	// blocker and on a red check, and those are the runs whose wait is longest — reporting nothing for
	// them would leave the measurement blind to exactly the invocations worth measuring.
	interrupted: 'interrupted',
} as const

interface FollowupStage {
	name: string
	duration_ms: number
}

// Mutable on purpose: the laps are recorded as the run passes them, and a log that returned a new
// value per lap would have every call site thread it back out.
//
// `last_ms` is `performance.now()`'s clock rather than `Date.now()`'s, for the reason
// `buffered-process.ts` states: it is monotonic, so a system clock adjusted mid-wait cannot produce a
// negative lap.
interface StageLog {
	stages: Array<FollowupStage>
	last_ms: number
}

function new_log(): StageLog {
	return { stages: [], last_ms: performance.now() }
}

function lap(log: StageLog, name: string): void {
	const now_ms = performance.now()

	log.stages.push({ name, duration_ms: now_ms - log.last_ms })
	log.last_ms = now_ms
}

function total_ms(stages: ReadonlyArray<FollowupStage>): number {
	return stages.reduce((sum, stage) => sum + stage.duration_ms, NO_DURATION)
}

function format_stage(stage: FollowupStage): string {
	const name = stage.name.padEnd(STAGE_NAME_WIDTH)

	return `${STAGE_LINE_PREFIX}${name}${time_format.format_seconds(stage.duration_ms)}`
}

// **An empty log prints nothing at all**, rather than a total of zero: a `0.0 s` block would read as a
// measurement of a command that took no time. `git_pr_followup.run` cannot reach it — its `catch`
// marks `interrupted` before the print, so its log always holds a lap — so this is the answer for any
// other caller, and it is exercised by the unit test rather than by the command.
//
// **Every row is in seconds, including a `checks-wait` that ran for minutes.** `josh time` renders its
// own tables in minutes, but its rows are whole phases of a run, while these are the stages of one
// command and are read against each other: one unit keeps the rows comparable at a glance and the
// block parseable by one rule.
function format_stages(log: StageLog): Array<string> {
	if (log.stages.length === 0) return []

	const rows = log.stages.map((stage) => format_stage(stage))
	const total = time_format.format_seconds(total_ms(log.stages))

	return ['', ...rows, `${STAGE_TOTAL_PREFIX.padEnd(VALUE_COLUMN)}${total}`]
}

function print_stages(log: StageLog): void {
	for (const line of format_stages(log)) console.info(line)
}

const git_followup_stages = {
	STAGE,
	STAGE_LINE_PREFIX,
	STAGE_TOTAL_PREFIX,
	new_log,
	lap,
	total_ms,
	format_stages,
	print_stages,
}

export type { FollowupStage, StageLog }
export { git_followup_stages }
