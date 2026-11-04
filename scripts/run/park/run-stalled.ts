import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'

// What a `run:stalled` park says, written and read in one place (joshuafolkken/kit#4215): the park
// event carries the cause's short name after the label, the park comment its whole `Why:`, and the
// park comments, `backlog:plan --waves` and `run:board` name the one next action.

// Why a child was parked: `short` rides on the park event and the board row, `why` on the comment.
interface StallCause {
	short: string
	why: string
}

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
		: `${RESUME_COMMAND} ${issue_cite.plain(child)}`
}

// The next action as a clause, which a park comment's `Next:` and the plan's note end with.
function next_step(child: number | string): string {
	return `fix the cause, then use \`${resume_of(child, true)}\` in the live backlogrun or resume it with \`${resume_of(child, false)}\``
}

function park_event(child: number | string, cause: string): string {
	return `${issue_cite.plain(child)} parked (${CAUSE_LEAD}${cause})`
}

// The cause a park event's reason carries: `''` for a bare `run:stalled` (written before the event
// carried one), `undefined` for a reason that is no `run:stalled` park.
function cause_of(reason: string): string | undefined {
	if (reason === RUN_STALLED_LABEL) return ''

	return reason.startsWith(CAUSE_LEAD) ? reason.slice(CAUSE_LEAD.length) : undefined
}

// A stalled row leads with its resume action, followed by its recorded cause in parentheses.
function row_text(child: number | string, cause = '', is_backlog_live = false): string {
	const resume = `→ resume: ${resume_of(child, is_backlog_live)}`

	return cause === '' ? resume : `${resume} (${cause})`
}

const run_stalled = {
	CUT_NOT_RELAUNCHED,
	SESSION_UNFINISHED,
	STALE_HANDOFF,
	cause_of,
	next_step,
	park_event,
	resume_of,
	row_text,
}

export { run_stalled }
export type { StallCause }
