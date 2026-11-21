import { run_board_sound_synth } from './run-board-sound-synth'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8365: the matrix theme's typing sound — a short synthesized key click, sounded
// once every `LETTERS_PER_CLICK` letters at the theme row's `intro.letter_ms`. The values are the ones
// the user heard and approved (recorded on the Issue); the noise comes from a fixed seed, so the same
// click renders the same samples and the WAV cache keyed on them reuses its file.

const NAME = 'click'
const SAMPLE_RATE = 48_000
const MS_PER_SECOND = 1000
const PARTIALS: ReadonlyArray<{ hz: number; level: number }> = [
	{ hz: 9200, level: 1 },
	{ hz: 5700, level: 0.7 },
	{ hz: 15_850, level: 0.28 },
]
const NOISE_LEVEL = 0.2
const ATTACK_MS = 1
const HOLD_MS = 4.5
const RELEASE_MS = 4.5
const HOLD_END_LEVEL = 0.75
const PEAK = 0.5
const LETTERS_PER_CLICK = 2
// Clicks in one WAV, looped while letters type (as the teletype's `TRILL_PAIRS`).
const CLICKS = 80
const FULL_TURN = Math.PI + Math.PI
const NOISE_SPAN = 2
// Park–Miller's minimal standard generator: products stay below 2^53, so it is exact in a double.
const MODULUS = 2_147_483_647
const MULTIPLIER = 48_271
const SEED = 8365
const TOTAL_LEVEL = PARTIALS.reduce((sum, { level }) => sum + level, NOISE_LEVEL)

type Random = () => number

function seeded(seed: number = SEED): Random {
	const state = { value: seed }

	return () => {
		state.value = (state.value * MULTIPLIER) % MODULUS

		return state.value / MODULUS
	}
}

// A linear attack to full level, a fall to `HOLD_END_LEVEL` by `HOLD_MS`, then a linear release to 0.
function envelope(ms: number): number {
	if (ms < ATTACK_MS) return ms / ATTACK_MS
	if (ms < HOLD_MS) return 1 - ((1 - HOLD_END_LEVEL) * (ms - ATTACK_MS)) / (HOLD_MS - ATTACK_MS)

	return HOLD_END_LEVEL * Math.max(0, 1 - (ms - HOLD_MS) / RELEASE_MS)
}

function tone_at(seconds: number): number {
	return PARTIALS.reduce(
		(sum, { hz, level }) => sum + level * Math.sin(FULL_TURN * hz * seconds),
		0,
	)
}

// One click's samples in [-PEAK, PEAK]: the partials and the noise summed, divided by their total level.
function click(random: Random = seeded()): Array<number> {
	const length = Math.round(((HOLD_MS + RELEASE_MS) * SAMPLE_RATE) / MS_PER_SECOND)

	return Array.from({ length }, (_, index) => {
		const seconds = index / SAMPLE_RATE
		const noise = NOISE_LEVEL * (random() * NOISE_SPAN - 1)

		return (PEAK * envelope(seconds * MS_PER_SECOND) * (tone_at(seconds) + noise)) / TOTAL_LEVEL
	})
}

// `CLICKS` units of one click then silence, each `LETTERS_PER_CLICK` letters long, as 16-bit samples;
// a pace faster than the click cuts each click off at the next.
function typing_samples(letter_ms: number): Int16Array {
	const unit = Math.round((letter_ms * LETTERS_PER_CLICK * SAMPLE_RATE) / MS_PER_SECOND)
	const key = Int16Array.from(click(), (value) =>
		Math.round(value * run_board_sound_synth.FULL_SCALE),
	).subarray(0, unit)
	const samples = new Int16Array(unit * CLICKS)

	for (let index = 0; index < CLICKS; index++) samples.set(key, index * unit)

	return samples
}

// The typing WAV's path at the theme's letter pace; `undefined` when it cannot be written.
function typing_wav(letter_ms: number, directory?: string): string | undefined {
	return run_board_sound_wav.cached_samples(NAME, typing_samples(letter_ms), SAMPLE_RATE, directory)
}

const run_board_sound_click = {
	CLICKS,
	LETTERS_PER_CLICK,
	PEAK,
	SAMPLE_RATE,
	click,
	envelope,
	seeded,
	typing_samples,
	typing_wav,
}

export { run_board_sound_click }
