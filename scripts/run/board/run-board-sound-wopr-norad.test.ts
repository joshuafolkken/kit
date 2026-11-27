import { describe, expect, it } from 'vitest'
import { run_board_sound_shape } from './run-board-sound-shape'
import { run_board_sound_voice } from './run-board-sound-voice'
import { run_board_sound_wopr } from './run-board-sound-wopr'
import { run_board_sound_wopr_norad } from './run-board-sound-wopr-norad'
import { run_board_theme_wopr_parts } from './run-board-theme-wopr-parts'

// joshuafolkken/kit#9137: the wopr theme's command-room voices, each pinned to the values measured on
// the film's audio (or invented beside them) — checked by their waveforms and their cues' times.

const {
	alarm_cues,
	ambience,
	blink_sound,
	call_sound,
	ending_cues,
	finale_cue,
	opening_cues,
	row_beats,
	spin_cue,
} = run_board_sound_wopr_norad
const { LOCK_HIGH, LOCK_LOW } = run_board_sound_wopr
const { SAMPLE_RATE } = run_board_sound_shape
const { sample_at, sound_samples } = run_board_sound_voice
const { BEATS } = run_board_theme_wopr_parts
const MS_PER_SECOND = 1000
const RADIANS_PER_CYCLE = Math.PI + Math.PI
const TICK_MS = 50
const ROOM_TICK_HZ = 2120

function ms_of(samples: { length: number }): number {
	return (samples.length * MS_PER_SECOND) / SAMPLE_RATE
}

function span_of(samples: ReadonlyArray<number>, from_ms: number, to_ms: number): Array<number> {
	return samples.slice(sample_at(from_ms), sample_at(to_ms))
}

// How strongly `samples` sound at `hz`: their projection on a sine and a cosine of that pitch.
function level_at(samples: ReadonlyArray<number>, hz: number): number {
	let sine = 0
	let cosine = 0

	for (const [index, value] of samples.entries()) {
		const angle = (RADIANS_PER_CYCLE * hz * index) / SAMPLE_RATE

		sine += value * Math.sin(angle)
		cosine += value * Math.cos(angle)
	}

	return Math.hypot(sine, cosine) / samples.length
}

// The loudest sample from `from_ms` to `to_ms`.
function top_of(samples: ReadonlyArray<number>, from_ms: number, to_ms: number): number {
	let top = 0

	for (const value of span_of(samples, from_ms, to_ms)) top = Math.max(top, Math.abs(value))

	return top
}

describe('run_board_sound_wopr_norad NORAD’s call', () => {
	const sound = call_sound()
	const samples = sound_samples(sound)
	const SHORTS = [935, 1375, 1815]

	it('lasts 2090 ms at 0.16', () => {
		expect(ms_of(samples)).toBe(2090)
		expect(sound.peak).toBe(0.16)
	})

	it('holds a long note of 1905, 2380, 2740 and 2860 Hz for 770 ms', () => {
		const long = span_of(samples, 0, 770)

		for (const hz of [1905, 2380, 2740, 2860]) expect(level_at(long, hz)).toBeGreaterThan(0.1)
		expect(level_at(long, 4090)).toBeLessThan(0.01)
		expect(top_of(samples, 771, 935)).toBe(0)
	})

	it('then sounds three 275 ms notes of 4090 Hz at 935, 1375 and 1815 ms', () => {
		for (const at_ms of SHORTS) {
			const short = span_of(samples, at_ms, at_ms + 275)

			expect(level_at(short, 4090)).toBeGreaterThan(0.3)
			expect(level_at(short, 1905)).toBeLessThan(0.01)
			expect(top_of(samples, at_ms - 10, at_ms)).toBe(0)
		}

		expect(top_of(samples, 1211, 1375)).toBe(0)
	})
})

describe('run_board_sound_wopr_norad the cabinet’s ambience', () => {
	const MS = 6000
	const samples = ambience(MS)

	function tick_level(at_ms: number): number {
		return level_at(span_of(samples, at_ms, at_ms + 24), ROOM_TICK_HZ)
	}

	it('lasts as long as asked, faded over 5 ms at both ends', () => {
		expect(samples).toHaveLength(sample_at(MS))
		expect(Math.abs(samples[0] ?? 1)).toBe(0)
		expect(Math.abs(samples.at(-1) ?? 1)).toBe(0)
		expect(top_of(samples, 0, 1)).toBeLessThan(top_of(samples, 5, 50) / 2)
	})

	it('hums at 125 Hz', () => {
		const second = span_of(samples, 1000, 2000)

		expect(level_at(second, 125)).toBeCloseTo(0.5, 1)
		expect(level_at(second, 250)).toBeLessThan(0.05)
	})

	it('ticks in pairs 210 ms apart, every 2600 ms from 1300 ms', () => {
		const quiet = tick_level(1400)

		for (const at_ms of [1300, 1510, 3900, 4110]) {
			expect(tick_level(at_ms)).toBeGreaterThan(quiet * 10)
		}

		for (const at_ms of [1000, 1700, 2600, 3600]) {
			expect(tick_level(at_ms)).toBeLessThan(0.01)
		}
	})
})

describe('run_board_sound_wopr_norad the tone the games end on', () => {
	const cue = finale_cue()
	const samples = sound_samples(cue.sound)

	it('lasts 170 ms at 0.06, ending at the peak', () => {
		expect(ms_of(samples)).toBe(170)
		expect(cue.sound.peak).toBe(0.06)
		expect(cue.at_ms + ms_of(samples)).toBe(4000)
	})

	it('sounds at 640 Hz with its odd harmonics above its even ones', () => {
		const base = level_at(samples, 640)

		expect(level_at(samples, 1920) / base).toBeCloseTo(10 ** (-9.5 / 20), 1)
		expect(level_at(samples, 1280)).toBeLessThan(level_at(samples, 1920))
		expect(level_at(samples, 2560)).toBeLessThan(level_at(samples, 3200))
	})
})

describe('run_board_sound_wopr_norad the code spinning', () => {
	const cue = spin_cue(100)
	const samples = sound_samples(cue.sound)

	it('fills the asked length from the start at 0.015', () => {
		expect(cue.at_ms).toBe(0)
		expect(ms_of(samples)).toBe(100)
		expect(cue.sound.peak).toBe(0.015)
	})

	it('ticks 6 ms at 4930 Hz every 37 ms, only where a whole tick fits', () => {
		for (const at_ms of [0, 37, 74]) {
			expect(level_at(span_of(samples, at_ms, at_ms + 6), 4930)).toBeGreaterThan(0.1)
			expect(top_of(samples, at_ms + 6, at_ms + 37)).toBe(0)
		}
	})
})

describe('run_board_sound_wopr_norad the alarm’s drone', () => {
	const cues = alarm_cues()

	it('sounds 7 notes 1 s apart from 200 ms after the peak', () => {
		expect(cues.map(({ at_ms }) => at_ms)).toStrictEqual([200, 1200, 2200, 3200, 4200, 5200, 6200])
	})

	it('lasts each 600 ms at 0.05, pitched at 416 Hz', () => {
		for (const { sound } of cues) {
			const samples = sound_samples(sound)

			expect(ms_of(samples)).toBe(600)
			expect(sound.peak).toBe(0.05)
			expect(level_at(samples, 416)).toBeGreaterThan(level_at(samples, 832))
		}
	})
})

describe('run_board_sound_wopr_norad the notice’s blink', () => {
	it('lasts 140 ms at 0.12 on NORAD’s short pitch', () => {
		const sound = blink_sound()
		const samples = sound_samples(sound)

		expect(ms_of(samples)).toBe(140)
		expect(sound.peak).toBe(0.12)
		expect(level_at(samples, 4090)).toBeGreaterThan(0.3)
	})
})

function times(cues: ReadonlyArray<{ at_ms: number }>): Array<number> {
	return cues.map(({ at_ms }) => at_ms)
}

describe('run_board_sound_wopr_norad the opening’s and the ending’s one-shots', () => {
	it('plays the high note at 0 ms and the low one at 3050 ms, at 0.08', () => {
		const cues = opening_cues()

		expect(times(cues)).toStrictEqual([0, BEATS.reveal * TICK_MS])
		expect(times(cues)).toStrictEqual([0, 3050])
		const layers = [LOCK_HIGH.layers, LOCK_LOW.layers]

		expect(cues.map(({ sound }) => sound.layers)).toStrictEqual(layers)
		expect(cues.map(({ sound }) => ms_of(sound_samples(sound)))).toStrictEqual([190, 250])
		expect(cues.every(({ sound }) => sound.peak === 0.08)).toBe(true)
	})

	it('plays the low note at 2000 ms, the high one at 2300 ms, the tick pair at 5350 ms', () => {
		const cues = ending_cues()

		expect(times(cues)).toStrictEqual(
			[BEATS.dark, BEATS.words, BEATS.empty].map((t) => t * TICK_MS),
		)
		expect(times(cues)).toStrictEqual([2000, 2300, 5350])
		expect(cues.slice(0, 2).map(({ sound }) => sound.layers)).toStrictEqual([
			LOCK_LOW.layers,
			LOCK_HIGH.layers,
		])
		expect(cues.map(({ sound }) => sound.peak)).toStrictEqual([0.08, 0.08, 0.06])
	})

	it('sounds the cabinet’s tick pair as two 24 ms ticks 210 ms apart', () => {
		const samples = sound_samples(ending_cues()[2]?.sound ?? LOCK_LOW)

		expect(ms_of(samples)).toBe(234)
		expect(level_at(span_of(samples, 0, 24), ROOM_TICK_HZ)).toBeGreaterThan(0.3)
		expect(level_at(span_of(samples, 210, 234), ROOM_TICK_HZ)).toBeGreaterThan(0.3)
		expect(top_of(samples, 25, 209)).toBe(0)
	})
})

describe('run_board_sound_wopr_norad a ROW’s beats', () => {
	it('adds the code spinning all through the row to the game’s beeps', () => {
		const LETTERS = 100
		const beats = row_beats(LETTERS)
		const spin = beats.at(-1)

		expect(beats.slice(0, -1).map(({ at_ms }) => at_ms)).toStrictEqual(
			run_board_sound_wopr.row_beats(LETTERS).map(({ at_ms }) => at_ms),
		)
		expect(spin?.at_ms).toBe(0)
		expect(spin?.sound.peak).toBe(0.015)
		expect(ms_of(sound_samples(spin?.sound ?? LOCK_LOW))).toBe(LETTERS * TICK_MS)
	})
})
