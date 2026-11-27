import { describe, expect, it } from 'vitest'
import { run_board_sound_palettes_rk800_voice } from './run-board-sound-palettes-rk800-voice'
import { run_board_sound_score } from './run-board-sound-score'
import { run_board_sound_voice, type Sound } from './run-board-sound-voice'

// joshuafolkken/kit#9096: the rk800 board's sounds — sine partials at measured pitches over their
// measured lengths, compounds keeping each part at its moment and level, the hums and the menu pad.

const voice = run_board_sound_palettes_rk800_voice
const { TICK, PING, CHIME_B, LOW_SWELL, CLICK, compound, menu_pad, partials, swell } = voice
const { loudest } = run_board_sound_score
const { sample_at, sound_samples } = run_board_sound_voice
const HZ = 440
const SHORT_MS = 40
const PART_AT_MS = 50
const LEVEL = 0.5
const STRENGTH = 0.25
const PEAK = 0.3
const PAD_MS = 1000
const BRIEF_PAD_MS = 100
// A pad never falls below this share between its swells: 0.6 less 0.4.
const PAD_FLOOR = 0.2
const PRECISION = 6
// Every named sound of the vocabulary, the helpers left out.
const SOUNDS = Object.entries(voice).filter(
	(entry): entry is [string, Sound] => typeof entry[1] !== 'function',
)

// A sound's loudest sample.
function top_of(sound: Sound): number {
	return loudest(sound_samples(sound))
}

describe('run_board_sound_palettes_rk800_voice vocabulary', () => {
	it.each(SOUNDS)('sounds %s', (_, sound) => {
		expect(top_of(sound)).toBeGreaterThan(0)
	})

	it.each([
		[TICK, 30],
		[PING, 90],
		[CHIME_B, 2400],
		[CLICK, 40],
		[LOW_SWELL, 4000],
	])('lasts its measured length', (sound, ms) => {
		expect(sound_samples(sound)).toHaveLength(sample_at(ms))
	})
})

describe('run_board_sound_palettes_rk800_voice partials', () => {
	it('sounds a partial at its strength beside the strongest', () => {
		const top = top_of(partials(SHORT_MS, SHORT_MS, [HZ, STRENGTH]))

		expect(top).toBeGreaterThan(0)
		expect(top).toBeLessThanOrEqual(STRENGTH)
	})

	it('swells in from silence and back', () => {
		const samples = sound_samples(swell(PAD_MS, [HZ, 1]))

		expect(samples[0]).toBe(0)
		const last = samples.slice(-sample_at(1))

		expect(loudest(last)).toBeLessThan(STRENGTH)
		expect(loudest(samples)).toBeGreaterThan(LEVEL)
	})

	it('pads as long as asked, never quite silent, one swell at the least', () => {
		const pad = sound_samples(menu_pad(PAD_MS))
		const brief = sound_samples(menu_pad(BRIEF_PAD_MS))

		expect(pad).toHaveLength(sample_at(PAD_MS))
		expect(brief).toHaveLength(sample_at(BRIEF_PAD_MS))
		const first = pad.slice(0, sample_at(PART_AT_MS))

		expect(loudest(first)).toBeGreaterThan(PAD_FLOOR / 2)
	})
})

describe('run_board_sound_palettes_rk800_voice compound', () => {
	it('starts a part at its moment, at its level', () => {
		const samples = sound_samples(compound(PEAK, [PART_AT_MS, LEVEL, CLICK]))
		const start = sample_at(PART_AT_MS)

		expect(loudest(samples.slice(0, start))).toBe(0)
		expect(loudest(samples)).toBeCloseTo(LEVEL, PRECISION)
		expect(samples).toHaveLength(start + sample_at(SHORT_MS))
	})

	it('keeps its peak and mixes parts sounding together', () => {
		const sound = compound(PEAK, [0, LEVEL, CLICK], [0, LEVEL, CLICK])

		expect(sound.peak).toBe(PEAK)
		expect(top_of(sound)).toBeCloseTo(1, PRECISION)
	})

	it('leaves a silent part silent', () => {
		const quiet = partials(SHORT_MS, SHORT_MS, [HZ, 0])

		expect(top_of(compound(PEAK, [0, LEVEL, quiet]))).toBe(0)
	})
})
