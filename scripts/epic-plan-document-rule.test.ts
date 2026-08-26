import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

// joshuafolkken/kit#862: front-loading the decisions only works if three things survive a reword —
// the audit runs before the batch, the batch is one question for the whole epic, and recording an
// answer clears the child's park. Losing the first makes decisions on a contradictory plan; losing the
// second asks the same question per child; losing the third leaves a child stopped after the answer
// arrived.

function read_unwrapped(relative_path: string): string {
	return read_repo_file(relative_path).replaceAll(/\s+/gu, ' ')
}

const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'`josh epic:plan <E>` front-loads',
	'run `josh epic:audit` and fix what it finds (Tier A)',
	'as a single question for the whole epic',
	'`## Decisions` section and a comment on each child',
	"Recording a decision removes that child's `needs-decision` label",
	'`auto` (Tier A, decide it), `ask` (Tier B/C, collect it) or `defer`',
]

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'矛盾を抱えた計画に対して一括決定を行っても、決定ごと作り直しになる',
	'省略可能な確認ではない',
	'EPIC 全体で 1 回の質問',
	'片方だけでは後から辿れない',
	'これが無いと、判断が返ったのに子が永久に止まる',
]

// The four phases in order; a document that keeps the command but loses the ordering describes a
// batch decision made before the audit that is supposed to precede it.
const PHASE_MARKERS: ReadonlyArray<string> = [
	'[相 0 整合監査]',
	'[相 1 トリアージ]',
	'[相 2 一括決定]',
	'[相 3 無人実行]',
]

// The section format, which is what makes a decision readable months later.
const DECISION_FORMAT_MARKERS: ReadonlyArray<string> = [
	'## Decisions',
	'- 対象:',
	'- 採用:',
	'- 却下:',
	'- 理由:',
	'- 決定日:',
]

describe('epic:plan documentation', () => {
	it.each(AI_DOCS)('is defined in %s', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('has a canonical section in the workflow prompt', () => {
		const content = read_unwrapped(WORKFLOW_PROMPT)

		for (const marker of CANONICAL_MARKERS) expect(content).toContain(marker)
	})

	it('names the four phases in order', () => {
		const content = read_repo_file(WORKFLOW_PROMPT)
		const positions = PHASE_MARKERS.map((marker) => content.indexOf(marker))

		expect(positions.every((position) => position !== -1)).toBe(true)
		expect(positions).toEqual(positions.toSorted((left, right) => left - right))
	})

	it('defines the shape a decision is recorded in', () => {
		const content = read_repo_file(WORKFLOW_PROMPT)

		for (const marker of DECISION_FORMAT_MARKERS) expect(content).toContain(marker)
	})
})
