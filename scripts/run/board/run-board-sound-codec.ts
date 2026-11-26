import { run_board_sound_shape } from './run-board-sound-shape'

// The codec theme's voices (joshuafolkken/kit#8917): a short radio pip a letter, a short burst of
// static as a line ends, and a high two-tone call for the NOTICE — new tones, not a game's call.

const { noise, silence, tone, voice_wav } = run_board_sound_shape

const PIP_HZ = 1200
const PIP_MS = 15
const PIP_PEAK = 0.18
const STATIC_MS = 120
const STATIC_DECAY_MS = 50
const STATIC_SEED = 4242
const STATIC_PEAK = 0.2
// The call: a high tone, a short gap, a higher and longer one.
const CALL_FIRST_HZ = 1480
const CALL_FIRST_MS = 120
const CALL_GAP_MS = 40
const CALL_SECOND_HZ = 1976
const CALL_SECOND_MS = 200
const CALL_DECAY_MS = 150
const CALL_PEAK = 0.18

function pip(): Array<number> {
	return tone({ hz: PIP_HZ, ms: PIP_MS, wave: 'sine' })
}

function burst(): Array<number> {
	return noise(STATIC_MS, STATIC_DECAY_MS, STATIC_SEED)
}

function call(): Array<number> {
	return [
		...tone({ hz: CALL_FIRST_HZ, ms: CALL_FIRST_MS, wave: 'sine' }),
		...silence(CALL_GAP_MS),
		...tone({ hz: CALL_SECOND_HZ, ms: CALL_SECOND_MS, wave: 'sine', decay_ms: CALL_DECAY_MS }),
	]
}

function typing_wav(letter_ms: number, directory?: string): string | undefined {
	const voice = { name: 'codec-typing', peak: PIP_PEAK, part: pip }

	return run_board_sound_shape.typing_wav(voice, letter_ms, directory)
}

function typed_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'codec-typed', key: '', peak: STATIC_PEAK, render: burst }, directory)
}

function notice_wav(directory?: string): string | undefined {
	return voice_wav({ name: 'codec-notice', key: '', peak: CALL_PEAK, render: call }, directory)
}

const run_board_sound_codec = { burst, call, notice_wav, pip, typed_wav, typing_wav }

export { run_board_sound_codec }
