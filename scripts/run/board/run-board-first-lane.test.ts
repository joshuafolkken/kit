import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_first_lane } from './run-board-first-lane'
import { run_board_fit } from './run-board-fit'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#5519: the board draws how long the run's newest session took to open its first
// lane, and the legend names it, only once a lane opened — at the right end of the processes rule
// (joshuafolkken/kit#8474), no longer on the header's first line.

const { MINUTE, NOW, board_usage, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const BEATING = { last_event_ms: NOW - MINUTE, is_stopped: false }
const { ICON, LEGEND } = run_board_first_lane
const PROCESSES = '💻 processes'
const SPAN = `${ICON} 2′00″`

function lines_with(first_lane_ms: number | undefined): Array<string> {
	const usages = board_usage(new Map())

	return lines_of(header({ activity: { ...BEATING, first_lane_ms }, usages }))
}

function processes_rule(lines: ReadonlyArray<string>): string {
	return lines.find((line) => line.includes(PROCESSES)) ?? ''
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

describe('run_board processes rule -- time to first lane', () => {
	it('ends the processes rule on the span, off the first line, and names it in the legend', () => {
		const lines = lines_with(2 * MINUTE)

		expect(processes_rule(lines)).toMatch(new RegExp(`─ ${SPAN}$`, 'u'))
		expect(lines[0]).not.toContain(ICON)
		expect(lines.join('\n')).toContain(LEGEND)
	})

	it('keeps the processes rule as wide as without the span', () => {
		const spanned = processes_rule(lines_with(2 * MINUTE))
		const bare = processes_rule(lines_with(undefined))

		expect(run_board_fit.width_of(spanned)).toBe(run_board_fit.width_of(bare))
	})

	it('draws neither the span nor its legend before a lane opened', () => {
		const drawn = lines_with(undefined).join('\n')

		expect(drawn).not.toContain(ICON)
		expect(drawn).not.toContain(LEGEND)
	})

	it('draws the span as `TO` at the rule end in the wargames theme', () => {
		const rule = processes_rule(lines_with(2 * MINUTE))
		const themed = stripVTControlCharacters(run_board_theme.restyle('wargames', rule))

		expect(themed).toMatch(/-- TO 2′00″$/u)
		expect(run_board_fit.width_of(themed)).toBe(run_board_fit.width_of(rule))
	})
})
