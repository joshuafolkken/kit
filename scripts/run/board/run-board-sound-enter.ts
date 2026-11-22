import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8697: the bttf theme's typed-end sound — the time circuits accepting the date, played
// once a line types through. Its WAV starts with the pause after the line, so it is played the moment
// the line ends. A socket for now: that pause alone, until the ENTER beeps (`run-board-sound-dtmf.ts`)
// fill it.

const NAME = 'enter'
// The pause between the line's end and the first beep, held as the WAV's leading silence.
const GAP_MS = 120

// The typed-end WAV's path; `undefined` when it cannot be written.
function enter_wav(directory?: string): string | undefined {
	const samples = run_board_sound_dtmf.pcm(run_board_sound_dtmf.silence(GAP_MS))

	return run_board_sound_wav.cached_samples(
		NAME,
		samples,
		run_board_sound_dtmf.SAMPLE_RATE,
		directory,
	)
}

const run_board_sound_enter = { GAP_MS, NAME, enter_wav }

export { run_board_sound_enter }
