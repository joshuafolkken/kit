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
// which order. joshuafolkken/kit#4099: from the frame's bottom up — the footer, the legend, the rows
// under the notes, the notes, the thanks, then the rows above them: not yet started, parked, waiting
// on a decision, running — each stage from its oldest.

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

// One frame holding every stage: two parked and two running rows mixed in the active section as they
// started, two notes past one already hidden, then under them a wave of two not yet started and two
// finished rows, the legend and the footer — 24 lines whole.
const NOTES: NotesPart = { head: ['', '── 📝 ──'], lines: ['  new', '  old'], hidden: 1 }
const ACTIVE = section([
	issue(1, 'running', 30),
	issue(3, 'parked', 10),
	issue(5, 'running', 40),
	issue(6, 'parked', 5),
])
const WAVE = section([issue(7), issue(8)], ['', '── 1 ──'])
const ENDED = section([issue(2, 'finished', 20), issue(4, 'finished', 10)], ['', 'D'])
const STAGED = parts_of([ACTIVE], { notes: NOTES, below: [WAVE, ENDED], footer: FOOTER })
const KEPT_ACTIVE = ['', '  1', '  3', '  5', '  6']
const KEPT_NOTES = [...NOTES.head, '  new', '  old', '  more 1']
const KEPT_WAVE = ['', '── 1 ──', '  7', '  8']

describe('run_board_fit.fit order', () => {
	it('draws every part while the pane holds them', () => {
		expect(fit_wide(STAGED, 24)).toStrictEqual(whole(STAGED))
		expect(whole(STAGED)).toHaveLength(24)
	})

	it.each([
		['the footer first', 23, whole(STAGED).slice(0, -2)],
		['then the legend', 21, whole(STAGED).slice(0, -4)],
	])('gives way %s', (_, rows, lines) => {
		expect(fit_wide(STAGED, rows)).toStrictEqual(lines)
	})

	it('cuts the finished rows under the notes next', () => {
		const lines = [...HEADER, ...KEPT_ACTIVE, ...KEPT_NOTES, ...KEPT_WAVE, '  more 2']

		expect(fit_wide(STAGED, 19)).toStrictEqual(lines)
	})

	// joshuafolkken/kit#4099: a wave drawn under the notes gives way before them.
	it('cuts the rows not yet started under the notes before any note, from the plan end', () => {
		const wave = ['', '── 1 ──', '  7', '  more 3']

		expect(fit_wide(STAGED, 16)).toStrictEqual([...HEADER, ...KEPT_ACTIVE, ...KEPT_NOTES, ...wave])
		expect(fit_wide(STAGED, 15)).toStrictEqual([
			...HEADER,
			...KEPT_ACTIVE,
			'  more 4',
			...KEPT_NOTES,
		])
	})

	it('cuts the notes next, the oldest first, and the section with the last', () => {
		const notes = [...NOTES.head, '  new', '  more 2']

		expect(fit_wide(STAGED, 12)).toStrictEqual([...HEADER, ...KEPT_ACTIVE, '  more 4', ...notes])
		expect(fit_wide(STAGED, 11)).toStrictEqual([...HEADER, ...KEPT_ACTIVE, '  more 4'])
	})

	it('leads the plan’s more with a blank when no section is left above the notes', () => {
		const parts = parts_of([], { notes: NOTES, below: [WAVE] })

		expect(fit_wide(parts, 9)).toStrictEqual([...HEADER, '', '  more 2', ...KEPT_NOTES])
	})
})

describe('run_board_fit.fit order of the rows that stay longest', () => {
	it.each([
		['the oldest parked row', 7, ['', '  1', '  3', '  5', '  more 5']],
		['the other parked row', 6, ['', '  1', '  5', '  more 6']],
		['the running row that started first', 5, ['', '  5', '  more 7']],
		['the last running row', 4, ['', '  more 8']],
	])('then cuts %s', (_, rows, plan) => {
		expect(fit_wide(STAGED, rows)).toStrictEqual([...HEADER, ...plan])
	})
})

// joshuafolkken/kit#3815: the thanks go after the notes, before any row not yet started.
const THANKS = ['', '  🙏 fish']

describe('run_board_fit.fit thanks', () => {
	it('drops the footer and the legend before the thanks, and draws them right above the legend', () => {
		const thanks = ['', '  🙏 fish  KittenLab']
		const parts = parts_of([issues(2)], { thanks, footer: FOOTER })
		const shown = [...HEADER, '', '  1', '  2']

		expect(fit_wide(parts, 11)).toStrictEqual([...shown, ...thanks, ...LEGEND, ...FOOTER])
		expect(fit_wide(parts, 10)).toStrictEqual([...shown, ...thanks, ...LEGEND])
		expect(fit_wide(parts, 8)).toStrictEqual([...shown, ...thanks])
		expect(fit_wide(parts, 6)).toStrictEqual(shown)
	})
})

// joshuafolkken/kit#4099: the parts give way from the frame's bottom up — a running, a decision, a
// parked and a not-yet-started row above three notes, a 🔗 waiting and a finished row under them, the
// thanks, the legend and the footer — 24 lines whole.
const CROWDED_PLAN = section([
	issue(1, 'running', 5),
	issue(2, 'decision', 10),
	issue(3, 'parked', 10),
	issue(4),
])
const WAITING = section([issue(6, 'waiting', 20)], ['', 'W'])
const FINISHED = section([issue(5, 'finished', 10)], ['', 'D'])
const THREE_NOTES: NotesPart = { head: ['', 'N'], lines: ['  n1', '  n2', '  n3'], hidden: 0 }
const CROWDED = parts_of([CROWDED_PLAN], {
	notes: THREE_NOTES,
	below: [WAITING, FINISHED],
	thanks: THANKS,
	footer: FOOTER,
})
const CROWDED_ROWS = [...HEADER, '', '  1', '  2', '  3', '  4']

describe('run_board_fit.fit order from the bottom up', () => {
	it('cuts the finished and the 🔗 waiting rows under the notes before any note', () => {
		const notes = ['', 'N', '  n1', '  n2', '  n3']
		const waiting = ['', 'W', '  6', '  more 1']

		expect(whole(CROWDED)).toHaveLength(24)
		expect(fit_wide(CROWDED, 18)).toStrictEqual([...CROWDED_ROWS, ...notes, ...waiting, ...THANKS])
		expect(fit_wide(CROWDED, 15)).toStrictEqual([...CROWDED_ROWS, '  more 2', ...notes, ...THANKS])
	})

	it('cuts the notes oldest first, the plan’s more staying above them, before the thanks', () => {
		const plan = [...CROWDED_ROWS, '  more 2']

		expect(fit_wide(CROWDED, 14)).toStrictEqual([...plan, '', 'N', '  n1', '  more 2', ...THANKS])
		expect(fit_wide(CROWDED, 13)).toStrictEqual([...plan, ...THANKS])
		expect(fit_wide(CROWDED, 8)).toStrictEqual(plan)
	})

	it.each([
		['a row not yet started', 7, ['', '  1', '  2', '  3', '  more 3']],
		['then the parked row', 6, ['', '  1', '  2', '  more 4']],
		['then the row waiting on a decision, before the running row', 5, ['', '  1', '  more 5']],
		['the running row last', 4, ['', '  more 6']],
	])('after the thanks cuts %s', (_, rows, plan) => {
		expect(fit_wide(CROWDED, rows)).toStrictEqual([...HEADER, ...plan])
	})
})

// joshuafolkken/kit#4042: a folding section counts its own cut rows on its last line, not on the plan's
// `more N`, until its last row is cut and it goes.
const DONE_HEAD = ['', '── done ──']
const DONE = {
	...section(
		[issue(2, 'finished', 30), issue(3, 'finished', 20), issue(4, 'finished', 10)],
		DONE_HEAD,
	),
	fold: (cut: ReadonlyArray<PlanLine>): string => `  folded ${String(cut.length)}`,
}
const FOLDING = parts_of([section([issue(1, 'running', 5)]), DONE])
const RUNNING = [...HEADER, '', '  1']

describe('run_board_fit.fit folding section', () => {
	it('draws every row and no fold line while the pane holds them', () => {
		expect(fit_wide(FOLDING, 9)).toStrictEqual([...RUNNING, ...DONE_HEAD, '  2', '  3', '  4'])
	})

	it('folds the oldest rows into its own count, keeping its heading', () => {
		expect(fit_wide(FOLDING, 8)).toStrictEqual([...RUNNING, ...DONE_HEAD, '  2', '  folded 2'])
	})

	it('goes with its last row, the plan’s more counting every row it held', () => {
		expect(fit_wide(FOLDING, 7)).toStrictEqual([...RUNNING, '  more 3'])
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
