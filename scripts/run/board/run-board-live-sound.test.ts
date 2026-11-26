import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { KeyReading } from './run-board-keys'
import { run_board_live_sound } from './run-board-live-sound'
import { run_board_sound_player, type Playing } from './run-board-sound-player'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8917: the live board's one-shot sounds. An event's sound stops every sound before
// it, and a lower event stays silent while a higher one plays; a skipped opening ends every sound and
// sounds the board appearing once; the NOTICE track is rendered ahead. No sound plays: the player is
// stubbed and its calls kept.

const { hush, heard, is_sounding, scored, skipped, switched_end, warm } = run_board_live_sound
const { score } = run_board_theme_defs.THEME_DEFS.wopr
const LETTERS = 12
const PART_MS = 2000
const NOTICE_WAV = 'notice.wav'
const ROW_WAV_FILE = 'row.wav'
const PROGRESS_WAV = 'progress.wav'
const PART_WAV = 'part.wav'
const APPEAR_WAV = 'appear.wav'

interface Child {
	child: Playing
	exit: () => void
}

interface Played {
	start: MockInstance<typeof run_board_sound_player.start>
	stop_all: MockInstance<typeof run_board_sound_player.stop_all>
	started: Array<Child>
}

// A player process that ends when the test says.
function child_of(): Child {
	const exits: Array<() => void> = []
	const child: Playing = {
		on: (event, listener) => {
			if (event === 'exit') exits.push(() => listener(0))
		},
		unref: () => undefined,
		kill: () => undefined,
	}

	return {
		child,
		exit: () => {
			for (const exit of exits) exit()
		},
	}
}

// The player stubbed: each start hands back a child of its own, kept to end it by hand.
function played(): Played {
	const started: Array<Child> = []
	const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation((_file, handlers) => {
		const each = child_of()

		started.push(each)
		handlers.started(each.child)
	})
	const stop_all = vi.spyOn(run_board_sound_player, 'stop_all').mockImplementation(() => undefined)

	return { start, stop_all, started }
}

function keys_of(is_on: boolean): KeyReading {
	return { folded: undefined, sound: () => is_on }
}

function scores_files(): void {
	vi.spyOn(score, 'notice').mockReturnValue(NOTICE_WAV)
	vi.spyOn(score, 'row').mockReturnValue(ROW_WAV_FILE)
	vi.spyOn(score, 'progress').mockReturnValue(PROGRESS_WAV)
	vi.spyOn(score, 'part').mockReturnValue(PART_WAV)
	vi.spyOn(score, 'appear').mockReturnValue(APPEAR_WAV)
}

function files(test: Played): Array<string> {
	return test.start.mock.calls.map(([file]) => file)
}

beforeEach(() => {
	scores_files()
})

afterEach(() => {
	vi.spyOn(run_board_sound_player, 'stop_all').mockImplementation(() => undefined)
	hush()
	vi.restoreAllMocks()
})

describe('run_board_live_sound.scored ranks', () => {
	it('sounds the shown theme’s event, every sound before it stopped first', () => {
		const test = played()

		scored(keys_of(true), () => 'wopr').event?.('row', LETTERS)

		expect(files(test)).toStrictEqual([ROW_WAV_FILE])
		expect(score.row).toHaveBeenCalledWith(LETTERS)
		expect(test.stop_all).toHaveBeenCalledOnce()
	})

	it('keeps a lower event silent while a higher one plays', () => {
		const test = played()
		const sound = scored(keys_of(true), () => 'wopr')

		sound.event?.('notice', LETTERS)
		sound.event?.('row', LETTERS)
		sound.event?.('progress', LETTERS)

		expect(files(test)).toStrictEqual([NOTICE_WAV])
	})

	it('sounds a lower event once the higher one has ended', () => {
		const test = played()
		const sound = scored(keys_of(true), () => 'wopr')

		sound.event?.('notice', LETTERS)
		test.started.at(0)?.exit()
		sound.event?.('progress', LETTERS)

		expect(files(test)).toStrictEqual([NOTICE_WAV, PROGRESS_WAV])
	})
})

describe('run_board_live_sound.scored cuts', () => {
	it('cuts an event with one of its rank or higher, every sound stopped', () => {
		const test = played()
		const sound = scored(keys_of(true), () => 'wopr')

		sound.event?.('row', LETTERS)
		sound.event?.('row', LETTERS)
		sound.event?.('notice', LETTERS)

		expect(files(test)).toStrictEqual([ROW_WAV_FILE, ROW_WAV_FILE, NOTICE_WAV])
		expect(test.stop_all).toHaveBeenCalledTimes(3)
	})

	it('ranks a part over every event', () => {
		const test = played()
		const sound = scored(keys_of(true), () => 'wopr')

		sound.part?.('ending', PART_MS)
		sound.event?.('notice', LETTERS)

		expect(files(test)).toStrictEqual([PART_WAV])
		expect(score.part).toHaveBeenCalledWith('ending', PART_MS)
	})
})

describe('run_board_live_sound.scored switch', () => {
	it('sounds nothing with the sound off or no theme shown', () => {
		const test = played()

		scored(keys_of(false), () => 'wopr').event?.('notice', LETTERS)
		scored(keys_of(true), () => undefined).event?.('notice', LETTERS)

		expect(test.start).not.toHaveBeenCalled()
	})
})

describe('run_board_live_sound.hush', () => {
	it('hushes every trill heard and stops every sound the board started', () => {
		const test = played()
		const trill = { hush: vi.fn() }

		heard(trill)
		hush()

		expect(trill.hush).toHaveBeenCalledOnce()
		expect(test.stop_all).toHaveBeenCalledOnce()
	})

	it('forgets the sounds it stopped, so a lower event sounds after', () => {
		const test = played()
		const sound = scored(keys_of(true), () => 'wopr')

		sound.event?.('notice', LETTERS)
		hush()
		sound.event?.('progress', LETTERS)

		expect(files(test)).toStrictEqual([NOTICE_WAV, PROGRESS_WAV])
	})
})

describe('run_board_live_sound.skipped', () => {
	it('stops every sound, then sounds the board appearing once while the sound is on', () => {
		const test = played()

		heard({ hush: vi.fn() })
		skipped(keys_of(true), 'wopr')

		expect(test.stop_all).toHaveBeenCalledOnce()
		expect(files(test)).toStrictEqual([APPEAR_WAV])
	})

	it('only stops every sound while the sound is off, or with no theme or keys', () => {
		const test = played()

		skipped(keys_of(false), 'wopr')
		skipped(keys_of(true), undefined)
		skipped(undefined, 'wopr')

		expect(test.stop_all).toHaveBeenCalledTimes(3)
		expect(test.start).not.toHaveBeenCalled()
	})
})

describe('run_board_live_sound switches', () => {
	it('reads the sound on where the keys carry no switch', () => {
		expect(is_sounding({ folded: undefined })).toBe(true)
		expect(is_sounding(keys_of(false))).toBe(false)
	})

	it('sounds a typed end only while the sound is on', () => {
		const typed_end = vi.fn<() => void>()

		switched_end(keys_of(false), typed_end)()
		switched_end(keys_of(true), typed_end)()

		expect(typed_end).toHaveBeenCalledOnce()
	})

	it('renders the theme’s NOTICE track ahead, nothing in no theme', () => {
		warm('wopr')
		warm(undefined)

		expect(score.notice).toHaveBeenCalledOnce()
	})
})
