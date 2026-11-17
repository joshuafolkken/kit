import { issue_cite } from '#scripts/issue/issue-cite'
import type { IssueComment } from '#scripts/issue/issue-read'

// The decision line `backlog:triage --adopt` leaves on the child, made and read here only: written by
// `backlog-triage-adopt.ts`, read by the park loop (`backlog-triage-park-loop.ts`) and by the board's
// pause reason (`run-board-pause.ts`).
const ADOPT_MARK = 'adopted park option '
const ADOPT_COMMAND = '(backlog:triage --adopt)'
const DONE_MARK = ' · parent action done: '
const OPTION_SHAPE = /^[1-9]\d*$/u

interface Adoption {
	issue: string
	option: number
	reason: string
	// The parent action taken before the adopt, or `''`.
	done: string
}

function text_of(adoption: Adoption): string {
	const { issue, option, reason, done } = adoption
	const adopted = `${ADOPT_MARK}${String(option)} ${ADOPT_COMMAND}`
	const action = done === '' ? '' : `${DONE_MARK}${done}`

	return `${issue_cite.plain_for('github', issue)}: ${adopted} — ${reason}${action}`
}

function is_adopt(comment: IssueComment): boolean {
	const { body } = comment

	return comment.is_trusted === true && body.includes(ADOPT_MARK) && body.includes(ADOPT_COMMAND)
}

// An adopt the child itself carries out in the lane: one with no parent action done.
function is_lane_option(comment: IssueComment | undefined): boolean {
	return comment !== undefined && !comment.body.includes(DONE_MARK)
}

// The option number a trusted decision line adopted, or `undefined` for any other comment.
function option_of(comment: IssueComment): number | undefined {
	if (!is_adopt(comment)) return undefined
	const after = comment.body.slice(comment.body.indexOf(ADOPT_MARK) + ADOPT_MARK.length)
	const [digits = ''] = after.split(` ${ADOPT_COMMAND}`, 1)

	return OPTION_SHAPE.test(digits) ? Number(digits) : undefined
}

const backlog_triage_adopted = { is_adopt, is_lane_option, option_of, text_of }

export { backlog_triage_adopted }
export type { Adoption }
