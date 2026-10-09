import { styleText } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit, type FrameParts, type PlanLine } from './run-board-fit'

// joshuafolkken/kit#3486: a live frame is kept within the terminal by cutting the plan from its end, so
// the header stays at the top; every line is counted by the rows it takes on screen.

const { fit, height_of, reserve } = run_board_fit
const HEADER = ['title', 'machine', 'progress']
const LEGEND = ['', 'legend']
const WIDE = 80

function issue(number: number): PlanLine {
	return { text: `  ${String(number)}`, rows: 1 }
}

function bare(text: string): PlanLine {
	return { text, rows: 0 }
}

function parts_of(plan: Array<PlanLine>, below = LEGEND): FrameParts {
	return { above: HEADER, plan, below }
}

function issues(count: number): Array<PlanLine> {
	return Array.from({ length: count }, (_, index) => issue(index + 1))
}

function rows_of(lines: ReadonlyArray<string>, columns: number): number {
	return lines.reduce((sum, line) => sum + height_of(line, columns), 0)
}

describe('run_board_fit.fit', () => {
	it('leaves a frame that fits as it is', () => {
		const parts = parts_of([bare(''), ...issues(2)])

		expect(fit(parts, { rows: 20, columns: WIDE })).toStrictEqual([
			...HEADER,
			'',
			'  1',
			'  2',
			...LEGEND,
		])
	})

	it('keeps the header and the legend, cutting the plan from its end into one more line', () => {
		const lines = fit(parts_of([bare(''), ...issues(10)]), { rows: 10, columns: WIDE })

		expect(lines).toStrictEqual([...HEADER, '', '  1', '  2', '  3', '  more 7', ...LEGEND])
	})

	it('counts the issue rows it hides, not the rules and epic lines between them', () => {
		const plan = [bare(''), issue(1), bare('── 1 ──'), issue(2), bare('  📁 9'), issue(3)]
		const lines = fit(parts_of(plan), { rows: 9, columns: WIDE })

		expect(lines).toStrictEqual([...HEADER, '', '  1', '  more 2', ...LEGEND])
	})

	it('counts a wrapped line by the rows it takes, escapes and all', () => {
		const legend = ['', styleText('dim', 'x'.repeat(25))]
		const lines = fit(parts_of([bare(''), ...issues(10)], legend), { rows: 12, columns: 10 })

		expect(lines.slice(0, 3)).toStrictEqual(HEADER)
		expect(rows_of(lines, 10)).toBeLessThanOrEqual(12)
		expect(lines).toContain('  more 7')
	})

	it('keeps the top of a frame when even the parts that stay are taller than the pane', () => {
		const lines = fit(parts_of([bare(''), ...issues(3)]), { rows: 2, columns: WIDE })

		expect(lines).toStrictEqual(['title', 'machine'])
	})
})

describe('run_board_fit.height_of', () => {
	it('counts a line by its width on screen, an empty one as one row', () => {
		expect(height_of('', WIDE)).toBe(1)
		expect(height_of('x'.repeat(21), 10)).toBe(3)
		expect(height_of('🔨'.repeat(5), 10)).toBe(1)
		const colored = styleText('red', 'x'.repeat(10))

		expect(height_of(colored, 10)).toBe(1)
	})
})

describe('run_board_fit.reserve', () => {
	it('leaves the rows the lines written below the frame do not take', () => {
		expect(reserve({ rows: 15, columns: 10 }, ['', 'x'.repeat(15)])).toStrictEqual({
			rows: 12,
			columns: 10,
		})
	})
})
