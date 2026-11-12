import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import type { SectionKey } from './run-board-fit'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

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
