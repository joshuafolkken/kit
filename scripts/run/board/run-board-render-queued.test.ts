import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4137: a running batch starts each row once a lane and its paths are free, never
// wave by wave, so the rows not yet started are one `⏳ queued` section in the plan's order.

const { header, lines_of, rule } = run_board_render_fixture
const REPO = 'joshuafolkken/kit'

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
