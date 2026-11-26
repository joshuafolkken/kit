import { describe, expect, it } from 'vitest'
import { run_board_demo_keys } from './run-board-demo-keys'
import { run_board_theme_host_sample } from './run-board-theme-host-sample'

// Demo mode's keys: one key each, none taken twice nor by a work's digit, each event one of the demo's.

const { DEMO_KEY, EVENT_OF_KEY, PART_OF_KEY } = run_board_demo_keys
const KEYS = [DEMO_KEY, ...EVENT_OF_KEY.keys(), ...PART_OF_KEY.keys()]
const EVENTS = run_board_theme_host_sample.demo_events('')

describe('run_board_demo_keys', () => {
	it('gives each press its own single key, no digit among them', () => {
		expect(new Set(KEYS).size).toBe(KEYS.length)
		expect(KEYS.filter((key) => !/^\D$/u.test(key))).toStrictEqual([])
	})

	it('plays the demo’s IDLE, PROGRESS, ROW and NOTICE, then the opening and the ending', () => {
		const names = Array.from(EVENT_OF_KEY.values(), (event) => EVENTS[event].name)

		expect(names).toStrictEqual(['IDLE', 'PROGRESS', 'ROW', 'NOTICE'])
		expect([...PART_OF_KEY.values()]).toStrictEqual(['opening', 'ending'])
	})
})
