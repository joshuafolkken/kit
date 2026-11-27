import { afterEach, beforeEach, vi } from 'vitest'
import { run_board_sound_player } from './run-board-sound-player'

// A board test that draws a theme in 24-bit color warms and plays through the real sound player,
// which the unit suite's sound guard refuses (joshuafolkken/kit#9094). These are the player's
// methods that spawn one; each is stubbed silent for every test in the calling file and restored after.
const SPAWNING = ['prepare', 'start', 'loop', 'play', 'play_cue'] as const

function silence(): void {
	for (const name of SPAWNING) {
		vi.spyOn(run_board_sound_player, name).mockReturnValue(undefined)
	}
}

// Registers the stubs around every test of the file that calls it at its top level.
function each(): void {
	beforeEach(silence)
	afterEach(() => {
		vi.restoreAllMocks()
	})
}

const run_board_sound_quiet = { each }

export { run_board_sound_quiet }
