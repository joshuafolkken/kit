import type { EpicChild } from '#scripts/epic/epic-graph'
import { has_label_name, NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { markdown_section } from '#scripts/issue/markdown-section'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { run_board_human } from './run-board-human'
import type {
	BlockerNeed,
	BoardPlan,
	DecisionBlocker,
	RowRead,
	RowReason,
} from './run-board-layout-types'
import { run_board_pause } from './run-board-pause'
import type { ItemStatus } from './run-board-status'

// A blocker the decision read walked to, with the title its listing or view carries.
interface DecisionNode extends EpicChild {
	title: string
}

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

// What a person does for a blocker the walk stopped at: a merge wait merges, a prepared filing is
// published, another stop the registry names is decided, and an issue outside the run is taken in.
function need_of(node: DecisionNode): BlockerNeed {
	if (has_label_name(node.labels, NEEDS_HUMAN_MERGE_LABEL)) return 'merge'
	if (issue_publication_state.is_pending(node.body)) return 'publish'

	return run_board_human.is_human(node.labels) ? 'decide' : 'take'
}

function blocker_of(node: DecisionNode, blocks: ReadonlyArray<number>): DecisionBlocker {
	const detail = HUMAN_DETAIL.exec(node.body ?? '')?.[1]

	return {
		...(detail !== undefined && { detail }),
		number: node.number,
		title: node.title,
		labels: node.labels,
		need: need_of(node),
		blocks,
	}
}

const run_board_decision = { blocker_of, comment_question, plan_reason, reason_of }

export { run_board_decision }
export type { DecisionNode }
