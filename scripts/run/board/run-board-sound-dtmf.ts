import { run_board_sound_synth } from './run-board-sound-synth'

// joshuafolkken/kit#8697: the bttf time circuits' keypad tone, the source the keypad loop
// (`run-board-sound-keypad.ts`) and the ENTER beeps (`run-board-sound-enter.ts`) are made from — a key's
// DTMF pair, its row and column tones summed and halved, peaking at `PEAK` of full scale, with a linear
// attack over `ATTACK_MS` and a linear release over the last `RELEASE_MS`. The values are the ones the
// user heard and approved (the Issue's demo, scene `1 ENTER`).

const SAMPLE_RATE = 48_000
const MS_PER_SECOND = 1000
// The keypad's row tones, top to bottom, and its column tones, left to right.
const ROW_HZ = { first: 697, second: 770, third: 852, fourth: 941 }
const COLUMN_HZ = { left: 1209, middle: 1336, right: 1477 }
const PEAK = 0.35
const ATTACK_MS = 2
const RELEASE_MS = 8
const TONES = 2
const FULL_TURN = Math.PI + Math.PI

// A key's row tone and column tone.
interface Pair {
	low: number
	high: number
}

// Each key on the keypad, row by row, with its pair.
const PAIRS: ReadonlyArray<Pair & { key: string }> = [
	{ key: '1', low: ROW_HZ.first, high: COLUMN_HZ.left },
	{ key: '2', low: ROW_HZ.first, high: COLUMN_HZ.middle },
	{ key: '3', low: ROW_HZ.first, high: COLUMN_HZ.right },
	{ key: '4', low: ROW_HZ.second, high: COLUMN_HZ.left },
	{ key: '5', low: ROW_HZ.second, high: COLUMN_HZ.middle },
	{ key: '6', low: ROW_HZ.second, high: COLUMN_HZ.right },
	{ key: '7', low: ROW_HZ.third, high: COLUMN_HZ.left },
	{ key: '8', low: ROW_HZ.third, high: COLUMN_HZ.middle },
	{ key: '9', low: ROW_HZ.third, high: COLUMN_HZ.right },
	{ key: '*', low: ROW_HZ.fourth, high: COLUMN_HZ.left },
	{ key: '0', low: ROW_HZ.fourth, high: COLUMN_HZ.middle },
	{ key: '#', low: ROW_HZ.fourth, high: COLUMN_HZ.right },
]

// The key's row and column tones; a character not on the keypad throws.
function pair_of(key: string): Pair {
	const pair = PAIRS.find((entry) => entry.key === key)

	if (pair === undefined) throw new Error(`no DTMF key: ${key}`)

	return { low: pair.low, high: pair.high }
}

// The level `ms` into a beep `length_ms` long: rising to full over the attack, falling to 0 over the
// release.
function envelope(ms: number, length_ms: number): number {
	if (ms < ATTACK_MS) return ms / ATTACK_MS
	if (ms > length_ms - RELEASE_MS) return Math.max(0, (length_ms - ms) / RELEASE_MS)

	return 1
}

function sine(hz: number, seconds: number): number {
	return Math.sin(FULL_TURN * hz * seconds)
}

function length_of(ms: number): number {
	return Math.round((ms * SAMPLE_RATE) / MS_PER_SECOND)
}

// The key's beep `length_ms` long, as samples in [-PEAK, PEAK].
function beep(key: string, length_ms: number): Array<number> {
	const { low, high } = pair_of(key)

	return Array.from({ length: length_of(length_ms) }, (_, index) => {
		const seconds = index / SAMPLE_RATE
		const level = PEAK * envelope(seconds * MS_PER_SECOND, length_ms)

		return (level * (sine(low, seconds) + sine(high, seconds))) / TONES
	})
}

// `ms` of silence, as samples.
function silence(ms: number): Array<number> {
	return Array.from({ length: length_of(ms) }, () => 0)
}

// Samples in [-1, 1] as the 16-bit samples a WAV holds.
function pcm(samples: ReadonlyArray<number>): Int16Array {
	return Int16Array.from(samples, (value) => Math.round(value * run_board_sound_synth.FULL_SCALE))
}

const run_board_sound_dtmf = {
	PEAK,
	SAMPLE_RATE,
	beep,
	envelope,
	pair_of,
	pcm,
	silence,
}

export { run_board_sound_dtmf }
