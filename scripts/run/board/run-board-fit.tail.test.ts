import { describe, expect, it } from 'vitest'
import { run_board_fit, type FrameParts, type PlanLine, type PlanSection } from './run-board-fit'

// joshuafolkken/kit#8512: a section with a tail at its rule's right end keeps its heading when every
// row is cut, so the tail stays drawn; one without a tail still goes, and `more N` stays with the plan.

const { ROW_INDENT, fit } = run_board_fit
const HEADER = ['state', 'clock']
const WIDE = 80
const ROWS = 5

function more(count: number): string {
	return `${ROW_INDENT}more ${String(count)}`
}

function issue(number: number): PlanLine {
	return { text: `  ${String(number)}`, row: { stage: 'pending', at_ms: undefined } }
}

function queued(tail?: string): PlanSection {
	return { head: ['', 'Q 3'], lines: [issue(1), issue(2), issue(3)], tail }
}

function parts_of(plan: Array<PlanSection>): FrameParts {
	return { above: HEADER, plan, notes: { head: [], lines: [], hidden: 0 }, legend: [], footer: [] }
}

describe('run_board_fit.fit a section with a tail on a short pane', () => {
	it('keeps the heading of a section with a tail whose rows are all cut', () => {
		const lines = fit(parts_of([queued('⏳')]), { rows: ROWS, columns: WIDE })

		expect(lines).toStrictEqual([...HEADER, '', 'Q 3', more(3)])
	})

	it('drops the heading of a section without a tail whose rows are all cut', () => {
		const lines = fit(parts_of([queued()]), { rows: ROWS, columns: WIDE })

		expect(lines).toStrictEqual([...HEADER, '', more(3)])
	})
})
