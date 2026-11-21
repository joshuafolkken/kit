import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { run_cut } from '#scripts/run/cut/run-cut'
import type { RunEvent } from '#scripts/run/event/run-event-stream'

// What a `run:stalled` park says, written and read in one place (joshuafolkken/kit#4215): the park
// event carries the cause's short name after the label, the park comment its whole `Why:`, and the
// park comments, `backlog:plan --waves` and `run:board` name the one next action.

// Why a child was parked: `short` rides on the park event and the board row, `why` on the comment.
interface StallCause {
	short: string
	why: string
}

type ParkStop = NonNullable<RunEvent['stop']>

// What `run:merge` judged when it parks a child with no ship stop to name.
const SESSION_UNFINISHED: StallCause = {
	short: 'session unfinished',
	why: 'the child’s session ended with its issue still open and unfinished.',
}
const CUT_NOT_RELAUNCHED: StallCause = {
	short: 'cut not relaunched',
	why: 'its lane held a declared cut, but no successor could be relaunched from it (or it already was once).',
}
const STALE_HANDOFF: StallCause = {
	short: 'stale hand-off',
	why: 'the child stopped at `resume: handed-off` because an old hand-off cut record was already adopted.',
}

const RESUME_COMMAND = 'fullrun'
const CAUSE_LEAD = `${RUN_STALLED_LABEL}: `

function resume_of(child: number | string, is_backlog_live = false): string {
	return is_backlog_live
		? `pnpm josh run:add ${String(child)} --retry`
		: `${RESUME_COMMAND} ${issue_cite.plain_for('program', child)}`
}

// A cause's recovery: the clause `Next:` words it with, and the one action to take first — a command
// with its arguments filled in, or `parent:` prose where no command does the work (joshuafolkken/kit#7850).
interface Recovery {
	clause: string
	first: (child: string) => string
}

const ORDINARY_RECOVERY: Recovery = {
	clause: 'fix the cause',
	first: (child) => `pnpm josh ship --log ${child}`,
}
const STALE_HANDOFF_RECOVERY: Recovery = {
	clause: `repair the stale hand-off cut record with \`${run_cut.END_COMMAND}\` (retry alone does not clear it)`,
	first: () => run_cut.END_COMMAND,
}
const HANDED_OFF_RECOVERY: Recovery = {
	clause: `clear the handed-off cut with \`${run_cut.END_COMMAND}\``,
	first: () => run_cut.END_COMMAND,
}
const ESCALATION_RECOVERY: Recovery = {
	clause: 'give it a stronger profile',
	first: () => 'parent: resume it one josh.worker profile up',
}

// The worker's own declaration that its Issue needs a stronger `josh.worker` profile
// (joshuafolkken/kit#7356). No retry check reads it, so `run:stalled`'s auto-retry never re-offers it
// on the same profile; the drive resumes it one profile up (joshuafolkken/kit#7357).
const ESCALATION_REQUESTED: StallCause = {
	short: 'escalation requested',
	why: 'the worker declared that its Issue needs a stronger josh.worker profile.',
}

function recovery_of(cause: string): Recovery {
	if (cause === STALE_HANDOFF.why) return STALE_HANDOFF_RECOVERY
	if (cause === ESCALATION_REQUESTED.why) return ESCALATION_RECOVERY

	return /cut.*(?:handed-off|already handed off)/iu.test(cause)
		? HANDED_OFF_RECOVERY
		: ORDINARY_RECOVERY
}

// The next action as a clause, which a park comment's `Next:` and the plan's note end with.
function next_step(child: number | string, cause = ''): string {
	const { clause } = recovery_of(cause)

	return `${clause}, then use \`${resume_of(child, true)}\` in the live backlogrun or resume it with \`${resume_of(child, false)}\``
}

// The one action to take first, which a park comment's `josh:outcome` marker carries for the board's
// row; the resume command stays on the comment's `Next:` line.
function next_action(child: number | string, cause = ''): string {
	return recovery_of(cause).first(String(child))
}

// The Japanese counterpart of `next_step` for the ordinary cause, which a Japanese park comment ends with.
function next_step_ja(child: number | string): string {
	return `原因を直してから、稼働中の backlogrun では \`${resume_of(child, true)}\`、それ以外では \`${resume_of(child, false)}\` で再開してください。`
}

// A child parked again on the lane tree it parked on before the last adopted option, so the option was
// never taken (joshuafolkken/kit#7820). No retry check reads it: a requeue would hit the same wall.
const PARK_LOOP: StallCause = {
	short: 'park loop',
	why: 'the child parked again on an unchanged lane tree after the adopted option, so the option was never taken.',
}

const CARRYING_CLASSES = [SESSION_UNFINISHED, ESCALATION_REQUESTED]

function lead_of(cause: StallCause): string {
	return `${cause.short}: `
}

// The message's first line rides behind its class, so a reader keyed on the class still finds it.
function carrying(cause: StallCause, message: string): StallCause {
	const first = message.split(/\r?\n/u, 1)[0]?.trim() ?? ''

	return first === '' ? cause : { short: `${lead_of(cause)}${first}`, why: first }
}

function session_unfinished(message: string): StallCause {
	return carrying(SESSION_UNFINISHED, message)
}

function escalation_requested(reason: string): StallCause {
	return carrying(ESCALATION_REQUESTED, reason)
}

// The class a park's cause names: `session unfinished` for one carrying the child's message too.
function class_of(cause: string): string {
	const carried = CARRYING_CLASSES.find((known) => cause.startsWith(lead_of(known)))

	return carried?.short ?? cause
}

function park_event(child: number | string, cause: string): string {
	return `${issue_cite.plain_for('program', child)} parked (${CAUSE_LEAD}${cause})`
}

// The cause a park event's reason carries: `''` for a bare `run:stalled` (written before the event
// carried one), `undefined` for a reason that is no `run:stalled` park.
function cause_of(reason: string): string | undefined {
	if (reason === RUN_STALLED_LABEL) return ''

	return reason.startsWith(CAUSE_LEAD) ? reason.slice(CAUSE_LEAD.length) : undefined
}

// The cause a park event's text carries — `park_event`'s inverse — or `undefined` for a text that is
// no `run:stalled` park with a cause.
function cause_in(text: string): string | undefined {
	const lead = ` parked (${CAUSE_LEAD}`
	const start = text.indexOf(lead)

	return start === -1 || !text.endsWith(')') ? undefined : text.slice(start + lead.length, -1)
}

// The ship stop a park event records — its stage and `Cause` class (joshuafolkken/kit#6864) — or
// `undefined` for a park written before it carried one, or one no ship stop took.
function stop_of(event: RunEvent): ParkStop | undefined {
	return event.stop
}

// A stalled row leads with its resume action, followed by its recorded cause in parentheses.
function row_text(child: number | string, cause = '', is_backlog_live = false): string {
	const resume = `→ resume: ${resume_of(child, is_backlog_live)}`

	return cause === '' ? resume : `${resume} (${cause})`
}

// A stalled child an open blocker still holds resumes after that blocker, not on a retry: `#6474`
// for a board wait of this repository, `owner/repo#N` as it is for another's.
function waiting_text(waits: ReadonlyArray<string>): string {
	return `waiting on ${waits.map((wait) => (wait.includes('#') ? wait : issue_cite.plain_for('program', wait))).join(', ')}`
}

const run_stalled = {
	CUT_NOT_RELAUNCHED,
	ESCALATION_REQUESTED,
	SESSION_UNFINISHED,
	STALE_HANDOFF,
	cause_in,
	cause_of,
	class_of,
	escalation_requested,
	next_action,
	next_step,
	next_step_ja,
	PARK_LOOP,
	park_event,
	resume_of,
	row_text,
	session_unfinished,
	stop_of,
	waiting_text,
}

export { run_stalled }
export type { ParkStop, StallCause }
