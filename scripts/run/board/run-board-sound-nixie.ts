import { run_board_sound_shape } from './run-board-sound-shape'

// The nixie theme's voices (joshuafolkken/kit#8917): a soft, low relay click a letter, a short clear
// high tone as a line settles, and a low hum rising to a high tone for the NOTICE.

const { mixed, noise, tone, voice_wav } = run_board_sound_shape

// The click's noise attack and its low ring.
const CLICK_NOISE_MS = 6
const CLICK_NOISE_DECAY_MS = 2
const CLICK_SEED = 8917
const RING_HZ = 180
const RING_MS = 30
const RING_DECAY_MS = 9
const RING_SHARE = 0.6
const CLICK_PEAK = 0.25
// The settled digit: a clear high tone with a faint octave above.
const SETTLE_HZ = 1568
const SETTLE_MS = 110
const SETTLE_DECAY_MS = 45
const OCTAVE = 2
const OCTAVE_SHARE = 0.2
const SETTLE_PEAK = 0.2
// The NOTICE: a low hum rising to a high tone, held a moment.
const RISE_FROM_HZ = 110
const RISE_TO_HZ = 880
const RISE_MS = 600
const HOLD_MS = 220
const HOLD_DECAY_MS = 120
const NOTICE_PEAK = 0.2

function click(): Array<number> {
	const attack = noise(CLICK_NOISE_MS, CLICK_NOISE_DECAY_MS, CLICK_SEED)
	const ring = tone({ hz: RING_HZ, ms: RING_MS, wave: 'sine', decay_ms: RING_DECAY_MS })

	return mixed(attack, ring, RING_SHARE)
}

function settle(): Array<number> {
	const base = tone({ hz: SETTLE_HZ, ms: SETTLE_MS, wave: 'sine', decay_ms: SETTLE_DECAY_MS })
	const upper = tone({
		hz: SETTLE_HZ * OCTAVE,
		ms: SETTLE_MS,
		wave: 'sine',
		decay_ms: SETTLE_DECAY_MS,
	})

	return mixed(base, upper, OCTAVE_SHARE)
}

function rise(): Array<number> {
	const sweep = tone({ hz: RISE_FROM_HZ, to_hz: RISE_TO_HZ, ms: RISE_MS, wave: 'triangle' })
	const hold = tone({ hz: RISE_TO_HZ, ms: HOLD_MS, wave: 'sine', decay_ms: HOLD_DECAY_MS })

	return [...sweep, ...hold]
}

function typing_wav(letter_ms: number, directory?: string): string | undefined {
	const voice = { name: 'nixie-typing', peak: CLICK_PEAK, part: click }

	return run_board_sound_shape.typing_wav(voice, letter_ms, directory)
}

function typed_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'nixie-typed', key: '', peak: SETTLE_PEAK, render: settle }, directory)
}

function notice_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'nixie-notice', key: '', peak: NOTICE_PEAK, render: rise }, directory)
}

const run_board_sound_nixie = { click, notice_wav, rise, settle, typed_wav, typing_wav }

export { run_board_sound_nixie }
