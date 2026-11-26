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

// joshuafolkken/kit#8917: the board in no theme sounds plainly — a short click for the info tier, soft
// rising notes for a notice.
const EXPECTED: ReadonlyArray<Expected> = [
	{ name: 'launch', min_ms: 12, max_ms: 12, wave: 'sine', direction: 'any' },
	{ name: 'lane-end', min_ms: 12, max_ms: 12, wave: 'sine', direction: 'any' },
	{ name: 'drain', min_ms: 12, max_ms: 12, wave: 'sine', direction: 'any' },
	{ name: 'human', min_ms: 340, max_ms: 340, wave: 'sine', direction: 'rising' },
	{ name: 'alert', min_ms: 340, max_ms: 340, wave: 'sine', direction: 'rising' },
]

function top_pitch(name: CueName): number {
	return Math.max(...CUES[name].notes.map((note) => frequency_of(note.pitch)))
}

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

	it('pitches the alert a step higher than the human notice', () => {
		expect(top_pitch('alert')).toBeGreaterThan(top_pitch('human'))
	})

	it('clicks launch, lane-end and drain with one and the same note', () => {
		expect(CUES['lane-end'].notes).toStrictEqual(CUES.launch.notes)
		expect(CUES.drain.notes).toStrictEqual(CUES.launch.notes)
		expect(CUES.launch.notes).toHaveLength(1)
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
