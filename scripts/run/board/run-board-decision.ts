import { markdown_section } from '#scripts/issue/markdown-section'
import type { BoardPlan, RowRead, RowReason } from './run-board-layout'

const QUESTION = /needs-decision\s*[:：—-]?\s*(.*)/u
const HEADING = /^#{1,6} (.+)$/u
const HUMAN_DETAIL = /^ *- *人の判断: *要[（(]([^）)\n]+)[）)]/mu

function question_of(reason = ''): string | undefined {
	const question = QUESTION.exec(reason)?.[1]?.trim()

	return question === '' ? undefined : question
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
	const question = question_of(reason) ?? read_question(number, read)

	if (question === '') return undefined

	return { tail: `→ decide: ${question}` }
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
