import { describe, expect, it } from 'vitest'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import { run_board_sound_synth, type Note, type Wave } from './run-board-sound-synth'

// joshuafolkken/kit#7946: five cues with their lengths, waves, directions and tiers.

const { CUES, TIER_ORDER, loudest } = run_board_sound_cues
const { REST, frequency_of } = run_board_sound_synth

type Direction = 'rising' | 'falling' | 'any'

interface Expected {
	readonly name: CueName
	readonly min_ms: number
	readonly max_ms: number
	readonly wave: Wave
	readonly direction: Direction
}

const EXPECTED: ReadonlyArray<Expected> = [
	{ name: 'launch', min_ms: 200, max_ms: 300, wave: 'sine', direction: 'rising' },
	{ name: 'lane-end', min_ms: 400, max_ms: 600, wave: 'sine', direction: 'rising' },
	{ name: 'drain', min_ms: 1000, max_ms: 1000, wave: 'sine', direction: 'rising' },
	{ name: 'human', min_ms: 1000, max_ms: 1000, wave: 'triangle', direction: 'any' },
	{ name: 'alert', min_ms: 3000, max_ms: 3000, wave: 'square', direction: 'falling' },
]

function total_ms(notes: ReadonlyArray<Note>): number {
	return notes.reduce((sum, note) => sum + note.ms, 0)
}

function direction_of(notes: ReadonlyArray<Note>): Direction {
	const sounding = notes.filter((note) => note.pitch !== REST).map((note) => note.pitch)
	const first = frequency_of(sounding.at(0) ?? REST)
	const last = frequency_of(sounding.at(-1) ?? REST)

	if (last > first) return 'rising'
	if (last < first) return 'falling'

	return 'any'
}

describe('run_board_sound_cues.CUES', () => {
	it('defines exactly the five cues', () => {
		expect(new Set(Object.keys(CUES))).toStrictEqual(
			new Set(EXPECTED.map((expected) => expected.name)),
		)
	})

	it.each(EXPECTED)('$name lasts within its range in total', ({ name, min_ms, max_ms }) => {
		const ms = total_ms(CUES[name].notes)

		expect(ms).toBeGreaterThanOrEqual(min_ms)
		expect(ms).toBeLessThanOrEqual(max_ms)
	})

	it.each(EXPECTED)('$name sounds its notes on the $wave wave', ({ name, wave }) => {
		expect(new Set(CUES[name].notes.map((note) => note.wave))).toStrictEqual(new Set([wave]))
	})

	it.each(EXPECTED.filter((expected) => expected.direction !== 'any'))(
		'$name is $direction from its first to its last sounding note',
		({ name, direction }) => {
			expect(direction_of(CUES[name].notes)).toBe(direction)
		},
	)

	it('repeats the alert figure three times', () => {
		const sounding = CUES.alert.notes.filter((note) => note.pitch !== REST)

		expect(sounding.map((note) => note.pitch)).toStrictEqual([
			'E5',
			'C5',
			'A4',
			'E5',
			'C5',
			'A4',
			'E5',
			'C5',
			'A4',
		])
	})
})

describe('run_board_sound_cues tiers', () => {
	it('orders the tiers alert over action over info', () => {
		expect(TIER_ORDER).toStrictEqual(['info', 'action', 'alert'])
	})

	it('gives launch, lane-end and drain info, human action and alert alert', () => {
		const tiers = Object.fromEntries(EXPECTED.map(({ name }) => [name, CUES[name].tier]))

		expect(tiers).toStrictEqual({
			launch: 'info',
			'lane-end': 'info',
			drain: 'info',
			human: 'action',
			alert: 'alert',
		})
	})

	it.each<{ names: Array<CueName>; winner: CueName | undefined }>([
		{ names: ['launch', 'human', 'drain'], winner: 'human' },
		{ names: ['human', 'alert', 'launch'], winner: 'alert' },
		{ names: ['drain', 'launch'], winner: 'drain' },
		{ names: [], winner: undefined },
	])('picks $winner as the loudest of $names', ({ names, winner }) => {
		expect(loudest(names)).toBe(winner)
	})
})
