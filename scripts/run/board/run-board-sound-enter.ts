import { run_board_sound_dtmf } from './run-board-sound-dtmf'
import { run_board_sound_wav } from './run-board-sound-wav'

// joshuafolkken/kit#8697, joshuafolkken/kit#8699: the bttf theme's typed-end sound — the time circuits
// accepting the date, played once the typing loop stops: two `#` key beeps. Its WAV starts with the
// pause after the line, so it is played the moment the line ends. The values are the ones the user heard
// and approved (the Issue's demo, scene `1 ENTER`).

const NAME = 'enter'
// The pause between the line's end and the first beep, held as the WAV's leading silence.
const GAP_MS = 120
const BEEP_MS = 70
// From the first beep's start to the second's.
const SPACING_MS = 110
// The keypad's `#`: 941 + 1477 Hz.
const KEY = '#'

// The gap, a beep, the rest of the spacing, and the same beep again.
function enter_samples(): Array<number> {
	const beep = run_board_sound_dtmf.beep(KEY, BEEP_MS)

	return [
		...run_board_sound_dtmf.silence(GAP_MS),
		...beep,
		...run_board_sound_dtmf.silence(SPACING_MS - BEEP_MS),
		...beep,
	]
}

// The typed-end WAV's path; `undefined` when it cannot be written.
function enter_wav(directory?: string): string | undefined {
	return run_board_sound_wav.resolved_samples(
		{
			name: NAME,
			key: '',
			sample_rate: run_board_sound_dtmf.SAMPLE_RATE,
			render: () => run_board_sound_dtmf.pcm(enter_samples()),
		},
		directory,
	)
}

const run_board_sound_enter = { BEEP_MS, GAP_MS, KEY, NAME, SPACING_MS, enter_samples, enter_wav }

export { run_board_sound_enter }
