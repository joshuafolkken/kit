import { markdown_section } from '#scripts/issue/markdown-section'
import type { BoardPlan, RowRead, RowReason } from './run-board-layout'

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

function comment_question(bodies: ReadonlyArray<string>): string | undefined {
	const body = bodies.at(-1)
	const heading = markdown_section.unfenced_lines(body ?? '').find((line) => HEADING.test(line))

	return HEADING.exec(heading ?? '')?.[1]?.trim()
}

function read_question(number: number, read: RowRead): string {
	return read.decision_questions?.get(number) ?? read.titles.get(number) ?? ''
}

function reason_of(
	number: number,
	reason: string | undefined,
	read: RowRead,
): RowReason | undefined {
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
