import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8697: the bttf theme's typing sound — the time-circuit keypad looped while the
// opening and the header's notice and now rows type. A socket for now: one letter of silence, until the
// keypad's beeps (`run-board-sound-dtmf.ts`) fill it.

const NAME = 'keypad'

// The typing WAV's path at the theme's letter pace; `undefined` when it cannot be written.
function typing_wav(letter_ms: number, directory?: string): string | undefined {
	const samples = run_board_sound_dtmf.pcm(run_board_sound_dtmf.silence(letter_ms))

	return run_board_sound_wav.cached_samples(
		NAME,
		samples,
		run_board_sound_dtmf.SAMPLE_RATE,
		directory,
	)
}

const run_board_sound_keypad = { typing_wav }

export { run_board_sound_keypad }
