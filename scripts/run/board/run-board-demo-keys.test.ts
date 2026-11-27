import { describe, expect, it } from 'vitest'
import { run_board_demo_keys } from './run-board-demo-keys'
import { run_board_theme_host_sample } from './run-board-theme-host-sample'

// Demo mode's keys: one key each, none taken twice nor by a work's digit, each event one of the demo's.

const { DEMO_KEY, EVENT_OF_KEY, PART_OF_KEY, THEME_KEYS, theme_index } = run_board_demo_keys
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

describe('run_board_demo_keys.theme_index', () => {
	it.each([
		['0', 0],
		['9', 9],
		['y', 10],
		['Y', 10],
	] as const)('picks the work at the place of %s', (key, index) => {
		expect(theme_index(key)).toBe(index)
	})

	it.each(['s', '/', 'yy', ''])('picks no work for %j', (key) => {
		expect(theme_index(key)).toBeUndefined()
	})

	it('shares no key with what a key plays', () => {
		expect(KEYS.filter((key) => THEME_KEYS.includes(key.toLowerCase()))).toStrictEqual([])
	})
})
