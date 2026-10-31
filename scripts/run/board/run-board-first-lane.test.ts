import { describe, expect, it } from 'vitest'
import { run_board_first_lane } from './run-board-first-lane'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#5519: the header's first line draws how long the run's newest session took to open
// its first lane, and the legend names it, only once a lane opened.

const { MINUTE, NOW, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const BEATING = { last_event_ms: NOW - MINUTE, is_stopped: false }
const { ICON, LEGEND } = run_board_first_lane

function lines_with(first_lane_ms: number | undefined): Array<string> {
	return lines_of(header({ activity: { ...BEATING, first_lane_ms } }))
}

describe('run_board_first_lane.part', () => {
	it('draws the icon with the span to the first lane', () => {
		expect(run_board_first_lane.part({ ...BEATING, first_lane_ms: 42 * SECOND })).toBe(
			`${ICON} 42″`,
		)
	})

	it('draws nothing before a lane opened', () => {
		expect(run_board_first_lane.part(BEATING)).toBeUndefined()
	})
})

describe('run_board_header first line -- time to first lane', () => {
	it('draws the span on the first line and names it in the legend', () => {
		const lines = lines_with(2 * MINUTE)

		expect(lines[0]).toContain(`${ICON} 2′00″`)
		expect(lines.join('\n')).toContain(LEGEND)
	})

	it('draws neither the span nor its legend before a lane opened', () => {
		const drawn = lines_with(undefined).join('\n')

		expect(drawn).not.toContain(ICON)
		expect(drawn).not.toContain(LEGEND)
	})
})
