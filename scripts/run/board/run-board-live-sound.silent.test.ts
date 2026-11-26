import { describe, expect, it, vi } from 'vitest'
import type { KeyReading } from './run-board-keys'
import { run_board_live_sound } from './run-board-live-sound'
import { run_board_sound_player } from './run-board-sound-player'

// joshuafolkken/kit#8915: a board that heard no trill — launched `--sound off`, so no typing sound is
// wired — stays silent when a key skips its opening, even with the switch flipped on by `s`. Its own
// file, so no other test's trill is heard first. No sound plays: the player is stubbed.

describe('run_board_live_sound.skipped on a board that heard no trill', () => {
	it('only stops every sound, though the sound switch reads on', () => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)
		const stop_all = vi
			.spyOn(run_board_sound_player, 'stop_all')
			.mockImplementation(() => undefined)
		const keys: KeyReading = { folded: undefined, sound: () => true }

		run_board_live_sound.skipped(keys, 'wopr')

		expect(stop_all).toHaveBeenCalledOnce()
		expect(start).not.toHaveBeenCalled()
	})
})
