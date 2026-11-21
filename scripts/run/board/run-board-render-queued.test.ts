import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_fit, type SectionKey } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#4137: a running batch starts each row once a lane and its paths are free, never
// wave by wave, so the rows not yet started are one `⏳ queued` section in the plan's order.

const { EMPTY_LAYOUT, header, lines_of, rule } = run_board_render_fixture
const REPO = 'joshuafolkken/kit'
const TALL = 200
const WIDE = 120
const EMPTY_QUEUED = rule('⏳ queued 0')

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: ['run:lane'], blocked_by: [] }
}

function plan_of(waves: Array<Array<EpicChild>>): BoardPlan {
	const numbers = waves.flat().map((item) => item.number)
	const titles = new Map(numbers.map((number) => [number, `Issue ${String(number)}`]))

	return {
		waves: { waves, unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles, open_numbers: new Set(numbers) },
		labels: new Map(),
	}
}

describe('run_board_render.render queued rows', () => {
	const layout = run_board_layout.layout_of(
		plan_of([[child(4134), child(4133)], [child(4131)], [child(4129)]]),
		new Map(),
	)
	const lines = lines_of(header({ layout }))

	it('draws a plan of three waves under one queued heading and no numbered one', () => {
		expect(lines.filter((line) => line.startsWith('── ⏳ queued '))).toHaveLength(1)
		expect(lines).not.toContain(rule('1'))
		expect(lines).not.toContain(rule('2'))
	})

	it('lists the rows in the order the waves give', () => {
		const order = ['4134', '4133', '4131', '4129'].map((number) =>
			lines.findIndex((line) => line.includes(` ${number} `)),
		)

		expect(order.every((index) => index !== -1)).toBe(true)
		expect(order).toStrictEqual(order.toSorted((left, right) => left - right))
	})
})

// joshuafolkken/kit#7281: an empty queue keeps its heading, saying `0`, so an empty queue reads apart
// from one not drawn and the sections keep their order.
const WAITING = { number: 7290, title: 'Issue 7290', state: 'waiting' as const, waits: [] }
const UNQUEUED = {
	...EMPTY_LAYOUT,
	unreached: [{ ...WAITING, status: undefined, kind: undefined }],
}

// The empty-queue board fitted to a tall pane, with `folded` folded.
function frame(folded: ReadonlySet<SectionKey>): Array<string> {
	const size = { rows: TALL, columns: WIDE }

	return run_board_render
		.render({ header: header({ layout: UNQUEUED }), notes: [], size, folded })
		.map((line) => stripVTControlCharacters(line))
}

describe('run_board_render.render an empty queue', () => {
	const layout = UNQUEUED

	it('draws a queued heading counting none one blank line before the waiting one', () => {
		const lines = lines_of(header({ layout }))
		const queued = lines.indexOf(EMPTY_QUEUED)

		expect(queued).not.toBe(-1)
		expect(lines.slice(queued, queued + 3)).toStrictEqual([EMPTY_QUEUED, '', rule('🔗 waiting 1')])
	})

	it('draws no empty decision, waiting or done heading', () => {
		const lines = lines_of(header())

		expect(lines).toContain(EMPTY_QUEUED)
		expect(lines.filter((line) => /^── .*\b(?:decision|waiting|done)\b/u.test(line))).toStrictEqual(
			[],
		)
	})

	it('draws no queued heading on a board without a plan', () => {
		const lines = lines_of(header({ layout: undefined }))

		expect(lines.filter((line) => line.includes('⏳ queued'))).toStrictEqual([])
	})

	it('keeps the empty queue heading whole open and folded', () => {
		const open = frame(new Set()).find((line) => line.startsWith('▾ ⏳ queued '))
		const shut = frame(new Set(['queued'])).find((line) => line.startsWith('▸ ⏳ queued '))

		expect(open).toMatch(/^▾ ⏳ queued 0 ─+$/u)
		expect(shut).toMatch(/^▸ ⏳ queued ─+ 0 ─+$/u)
	})
})

// joshuafolkken/kit#8115: a themed board keys a queued epic's 📁 line by the epic's number, after its
// indent, so the line types as it appears and the indent is drawn whole.
const EPIC_LAYOUT = {
	...EMPTY_LAYOUT,
	queued: [
		{
			kind: 'epic' as const,
			epic: 9,
			title: 'an epic',
			rows: [{ ...WAITING, status: undefined, kind: undefined }],
		},
	],
}

function epic_line(is_keyed: boolean): string {
	const line = lines_of(header({ layout: EPIC_LAYOUT, is_keyed })).find((text) =>
		text.includes('📁'),
	)

	return line ?? ''
}

describe('run_board_render.render a queued epic line', () => {
	it('keys the 📁 line after its indent where the board types rows', () => {
		const split = run_board_row_key.split_key(epic_line(true))

		expect(split.key).toBe('epic:9')
		expect(split.prefix).toMatch(/^ +$/u)
		expect(split.text).toBe(`${split.prefix}📁 9  an epic`)
	})

	it('draws the same words keyed or not, and no key on an untyped board', () => {
		const split = run_board_row_key.split_key(epic_line(false))

		expect(split.key).toBeUndefined()
		expect(run_board_row_key.without_key(epic_line(true))).toBe(epic_line(false))
	})
})

// joshuafolkken/kit#8224: a themed screen marks each title at its start, for the reveal to write it as
// one block; every other frame draws no mark.
const { TITLE_MARK, bare, untitled } = run_board_label_pair

function epic_lines(is_themed: boolean): Array<string> {
	return lines_of(
		header({ layout: EPIC_LAYOUT, theme: is_themed ? 'wargames' : undefined }),
	).filter((text) => text.includes('📁') || text.includes('7290'))
}

describe('run_board_render.render a title mark', () => {
	it('marks the epic and its issue row titles at their start on a themed screen', () => {
		const [epic = '', row = ''] = epic_lines(true)

		expect(epic).toContain(`📁 9  ${TITLE_MARK}an epic`)
		expect(row).toContain(`${TITLE_MARK}Issue 7290`)
	})

	it('draws the same columns marked or not, and no mark with no theme', () => {
		const themed = epic_lines(true)
		const plain = epic_lines(false)

		expect(plain.join('')).not.toContain(TITLE_MARK)
		expect(themed.map((line) => run_board_fit.width_of(line))).toStrictEqual(
			plain.map((line) => run_board_fit.width_of(line)),
		)
		expect(themed.map((line) => bare(untitled(line)))).toStrictEqual(plain)
	})
})
