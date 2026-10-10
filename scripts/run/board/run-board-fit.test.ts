import { styleText } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
	run_board_fit,
	type FrameParts,
	type NotesPart,
	type PlanLine,
	type PlanSection,
	type YieldStage,
} from './run-board-fit'

// joshuafolkken/kit#3486: a live frame is kept within the terminal, so the header stays at the top;
// every line is counted by the rows it takes on screen. joshuafolkken/kit#3505: what gives way, and in
// which order — the footer, the legend, the finished rows, the notes, the rows not yet started, the
// parked rows, the running rows — each stage from its oldest.

const { fit, height_of, whole } = run_board_fit
const HEADER = ['state', 'clock']
const LEGEND = ['', 'legend']
const FOOTER = ['', 'footer']
const WIDE = 80
const NO_NOTES: NotesPart = { head: [], lines: [], hidden: 0 }

function issue(number: number, stage: YieldStage = 'pending', at_ms?: number): PlanLine {
	return { text: `  ${String(number)}`, row: { stage, at_ms } }
}

function bare(text: string): PlanLine {
	return { text, row: undefined }
}

function section(lines: Array<PlanLine>, head = ['']): PlanSection {
	return { head, lines }
}

function parts_of(plan: Array<PlanSection>, extra: Partial<FrameParts> = {}): FrameParts {
	return { above: HEADER, plan, notes: NO_NOTES, legend: LEGEND, footer: [], ...extra }
}

function issues(count: number): PlanSection {
	return section(Array.from({ length: count }, (_, index) => issue(index + 1)))
}

function rows_of(lines: ReadonlyArray<string>, columns: number): number {
	return lines.reduce((sum, line) => sum + height_of(line, columns), 0)
}

function fit_wide(parts: FrameParts, rows: number): Array<string> {
	return fit(parts, { rows, columns: WIDE })
}

describe('run_board_fit.fit', () => {
	it('leaves a frame that fits as it is', () => {
		const parts = parts_of([issues(2)])

		expect(fit_wide(parts, 20)).toStrictEqual([...HEADER, '', '  1', '  2', ...LEGEND])
	})

	it('drops the legend, then cuts the plan from its end into one more line', () => {
		const lines = fit_wide(parts_of([issues(10)]), 7)

		expect(lines).toStrictEqual([...HEADER, '', '  1', '  2', '  3', '  more 7'])
	})

	it('counts the issue rows it hides, dropping a wave rule and an epic line left with none', () => {
		const wave = section([issue(2), bare('  📁 9'), issue(3)], ['', '── 1 ──'])
		const parts = parts_of([section([issue(1)]), wave])
		const lines = fit_wide(parts, 5)

		expect(lines).toStrictEqual([...HEADER, '', '  1', '  more 2'])
	})

	it('counts a wrapped line by the rows it takes, escapes and all', () => {
		const above = [...HEADER, styleText('dim', 'x'.repeat(25))]
		const lines = fit(parts_of([issues(10)], { above }), { rows: 14, columns: 10 })

		expect(lines.slice(0, 3)).toStrictEqual(above)
		expect(rows_of(lines, 10)).toBe(14)
		expect(lines.at(-1)).toBe('  more 3')
	})

	it('keeps the top of a frame when even the header is taller than the pane', () => {
		const parts = parts_of([issues(3)])

		expect(fit_wide(parts, 1)).toStrictEqual(['state'])
	})
})

// One frame holding every stage: two finished, two parked and two running rows mixed in the active
// section as they started, a wave of two not yet started, two notes past one already hidden, the
// legend and the footer — 22 lines whole.
const NOTES: NotesPart = { head: ['', '── 📝 ──'], lines: ['  new', '  old'], hidden: 1 }
const ACTIVE = section([
	issue(1, 'running', 30),
	issue(2, 'finished', 20),
	issue(3, 'parked', 10),
	issue(4, 'finished', 10),
	issue(5, 'running', 40),
	issue(6, 'parked', 5),
])
const WAVE = section([issue(7), issue(8)], ['', '── 1 ──'])
const STAGED = parts_of([ACTIVE, WAVE], { notes: NOTES, footer: FOOTER })
const KEPT_ACTIVE = ['', '  1', '  3', '  5', '  6']
const KEPT_WAVE = ['', '── 1 ──', '  7', '  8']

describe('run_board_fit.fit order', () => {
	it('draws every part while the pane holds them', () => {
		expect(fit_wide(STAGED, 22)).toStrictEqual(whole(STAGED))
		expect(whole(STAGED)).toHaveLength(22)
	})

	it.each([
		['the footer first', 21, whole(STAGED).slice(0, -2)],
		['then the legend', 19, whole(STAGED).slice(0, -4)],
	])('gives way %s', (_, rows, lines) => {
		expect(fit_wide(STAGED, rows)).toStrictEqual(lines)
	})

	it('cuts the finished rows next, the one that ended first before the other', () => {
		const notes = [...NOTES.head, '  new', '  old', '  more 1']

		expect(fit_wide(STAGED, 17)).toStrictEqual([
			...HEADER,
			...KEPT_ACTIVE,
			...KEPT_WAVE,
			'  more 2',
			...notes,
		])
	})

	it('cuts the notes next, the oldest first, and the section with the last', () => {
		const plan = [...HEADER, ...KEPT_ACTIVE, ...KEPT_WAVE, '  more 2']

		expect(fit_wide(STAGED, 16)).toStrictEqual([...plan, ...NOTES.head, '  new', '  more 2'])
		expect(fit_wide(STAGED, 15)).toStrictEqual(plan)
	})
})

describe('run_board_fit.fit order of the rows that stay longest', () => {
	it.each([
		[
			'a row not yet started from the plan end',
			11,
			[...KEPT_ACTIVE, '', '── 1 ──', '  7', '  more 3'],
		],
		['the last row not yet started, and its rule', 10, [...KEPT_ACTIVE, '  more 4']],
		['the oldest parked row', 7, ['', '  1', '  3', '  5', '  more 5']],
		['the other parked row', 6, ['', '  1', '  5', '  more 6']],
		['the running row that started first', 5, ['', '  5', '  more 7']],
		['the last running row', 4, ['', '  more 8']],
	])('then cuts %s', (_, rows, plan) => {
		expect(fit_wide(STAGED, rows)).toStrictEqual([...HEADER, ...plan])
	})
})

describe('run_board_fit.whole', () => {
	it('draws every part in its order, the notes counting the ones past their limit', () => {
		const notes = { head: ['', 'notes'], lines: ['  a'], hidden: 2 }
		const lines = whole(parts_of([issues(1)], { notes, footer: FOOTER }))
		const drawn_notes = ['', 'notes', '  a', '  more 2']

		expect(lines).toStrictEqual([...HEADER, '', '  1', ...drawn_notes, ...LEGEND, ...FOOTER])
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
