import { markdown_section } from '#scripts/issue/markdown-section'
import { run_park_body } from '#scripts/run/park/run-park-body'
import type { BoardPlan, RowRead, RowReason } from './run-board-layout'
import { run_board_pause } from './run-board-pause'
import type { ItemStatus } from './run-board-status'

// The park's question, then after `;` a note on why it parked that is not the question
// (`backlog-drive-retry.ts`: `needs-decision; blocker #M closed`).
const QUESTION = /needs-decision\s*[:：—-]?\s*(?<question>[^;]*)(?:;\s*(?<note>.+))?/u
const HEADING = /^#{1,6} (.+)$/u
const HUMAN_DETAIL = /^ *- *人の判断: *要[（(]([^）)\n]+)[）)]/mu

interface ParkParts {
	question: string | undefined
	note: string | undefined
}

function parts_of(reason = ''): ParkParts {
	const { question, note } = QUESTION.exec(reason)?.groups ?? {}

	return { question, note }
}

function question_of(question = ''): string | undefined {
	const trimmed = question.trim()

	return trimmed === '' ? undefined : trimmed
}

function note_of(note: string | undefined): string {
	return note === undefined ? '' : ` (${note.trim()})`
}

// A schema heading of the park body (`run-park-body.ts`) is not the question.
function is_question(line: string): boolean {
	return HEADING.test(line) && !run_park_body.HEADINGS.includes(line.trim())
}

function heading_of(body: string): string | undefined {
	const heading = markdown_section.unfenced_lines(body).find((line) => is_question(line))

	return HEADING.exec(heading ?? '')?.[1]?.trim()
}

// The latest park's round from its second on: a child parked more than once is a round trip
// (joshuafolkken/kit#7001). Every schema-conforming body counts as one park; a latest comment that is
// no park carries no round.
function round_of(bodies: ReadonlyArray<string>): string | undefined {
	if (run_park_body.summary_of(bodies.at(-1) ?? '') === undefined) return undefined
	const parks = bodies.filter((body) => run_park_body.summary_of(body) !== undefined).length

	return parks > 1 ? `park ${String(parks)} 回目` : undefined
}

// The park's question, then its recommendation and tier on the same line (joshuafolkken/kit#6688).
function comment_question(bodies: ReadonlyArray<string>): string | undefined {
	const body = bodies.at(-1) ?? ''
	const parts = [heading_of(body), run_park_body.summary_of(body), round_of(bodies)]
	const present = parts.filter((part) => part !== undefined)

	return present.length === 0 ? undefined : present.join(' — ')
}

function read_question(number: number, read: RowRead): string {
	return read.decision_questions?.get(number) ?? read.titles.get(number) ?? ''
}

function reason_of(
	number: number,
	reason: string | undefined,
	read: RowRead,
	status?: ItemStatus,
): RowReason | undefined {
	const pause = run_board_pause.reason_of(number, read, status)
	if (pause !== undefined) return pause
	const parts = parts_of(reason)
	const question = question_of(parts.question) ?? read_question(number, read)

	if (question === '') return undefined

	return { tail: `→ decide: ${question}${note_of(parts.note)}` }
}

function plan_reason(number: number, plan: BoardPlan): RowReason | undefined {
	return reason_of(number, undefined, { ...plan, titles: plan.context.titles })
}

function waiting_tail(reference: string, title: string, body = ''): string {
	const detail = HUMAN_DETAIL.exec(body)?.[1]
	const suffix = detail === undefined ? '' : ` (${detail})`

	return `→ decide ${reference}: ${title}${suffix}`
}

const run_board_decision = { comment_question, plan_reason, reason_of, waiting_tail }

export { run_board_decision }
