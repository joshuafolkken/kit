import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_scenario_data } from './run-board-theme-wopr-scenario-data'

const { SCENARIOS } = run_board_theme_wopr_scenario_data

describe('run_board_theme_wopr_scenario_data', () => {
	// cspell:disable -- the film's strategy names.
	it('names only the 18 confirmed strategies: the film’s in the order read, then the stills’', () => {
		expect(SCENARIOS).toStrictEqual([
			'U.S. FIRST STRIKE',
			'USSR FIRST STRIKE',
			'NATO / WARSAW PACT',
			'FAR EAST STRATEGY',
			'INDIA PAKISTAN WAR',
			'MEDITERRANEAN WAR',
			'HONGKONG VARIANT',
			'SEATO DECAPITATING',
			'ATLANTIC HEAVY',
			'CUBAN PARAMILITARY',
			'MIDDLE EAST HEAVY',
			'TAIWAN THEATERWIDE',
			'PACIFIC MANEUVER',
			'PORTUGAL REVOLUTION',
			'ALBANIAN DECOY',
			'CYPRUS MANEUVER',
			'EGYPT MISDIRECTION',
			'BANGLADESH THRUST',
		])
	})
	// cspell:enable

	it('names each strategy once, in capitals', () => {
		expect(new Set(SCENARIOS).size).toBe(SCENARIOS.length)
		expect(SCENARIOS.every((name) => name === name.toUpperCase())).toBe(true)
	})
})
