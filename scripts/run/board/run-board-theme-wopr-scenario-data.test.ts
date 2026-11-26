import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_scenario_data } from './run-board-theme-wopr-scenario-data'

const { SCENARIOS } = run_board_theme_wopr_scenario_data

describe('run_board_theme_wopr_scenario_data', () => {
	it('names the film’s first strikes', () => {
		expect(SCENARIOS.slice(7, 9)).toStrictEqual(['U.S. FIRST STRIKE', 'USSR FIRST STRIKE'])
	})

	it('names each strategy once, in capitals', () => {
		expect(new Set(SCENARIOS).size).toBe(SCENARIOS.length)
		expect(SCENARIOS.every((name) => name === name.toUpperCase())).toBe(true)
	})
})
