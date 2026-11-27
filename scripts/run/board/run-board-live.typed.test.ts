import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi, type MockInstance } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_live } from './run-board-live'
import { run_board_sound_enter } from './run-board-sound-enter'
import { run_board_sound_player } from './run-board-sound-player'
import { run_board_sound_quiet } from './run-board-sound-quiet-fixture'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_sound_wav } from './run-board-sound-wav'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8697: the theme's typed-end sound reaches the trill, and sounds only while the sound
// switch is on.

const LEFT_MS = 300
const ENTER_FILE = 'sounds/enter.wav'
const create_directory = temporary_directory()

interface Heard {
	typing_sound: TypingSound
	ends: Array<(() => void) | undefined>
}

// A trill that keeps the `ended` each `set` hands it.
function heard(): Heard {
	const ends: Array<(() => void) | undefined> = []

	return {
		ends,
		typing_sound: {
			set: (_is_on, _left_ms, ended) => {
				ends.push(ended)
			},
			stop: () => undefined,
		},
	}
}

function trill_with(
	is_sound_on: boolean,
	typed_end: () => void,
): Heard & { trill: TypingSound | undefined } {
	const test = heard()
	const trill = run_board_live.trill_of(
		{ typing_sound: test.typing_sound },
		{ folded: undefined, sound: () => is_sound_on },
		() => 'flux',
		typed_end,
	)

	return { ...test, trill }
}

run_board_sound_quiet.each()

describe('run_board_live.trill_of typed end', () => {
	// joshuafolkken/kit#8917: the typed end sounds at the time line's own moment through `typed`, never
	// from the trill's letters running out.
	it('hands the trill no end, the typed end left to `typed`', () => {
		const typed_end = vi.fn<() => void>()
		const test = trill_with(true, typed_end)

		test.trill?.set(true, LEFT_MS)

		expect(test.ends).toStrictEqual([undefined])
		expect(typed_end).not.toHaveBeenCalled()
	})

	it('sounds the typed end from `typed` while the sound is on', () => {
		const typed_end = vi.fn<() => void>()

		trill_with(true, typed_end).trill?.typed?.()

		expect(typed_end).toHaveBeenCalledOnce()
	})

	it('sounds no typed end while the sound is off', () => {
		const typed_end = vi.fn<() => void>()
		const test = trill_with(false, typed_end)

		test.trill?.set(true, LEFT_MS)
		test.ends[0]?.()
		test.trill?.typed?.()

		expect(typed_end).not.toHaveBeenCalled()
	})

	it('ac-f9b98b75 hands the flux trill over every row to the draws', () => {
		expect(run_board_theme_defs.THEME_DEFS.flux.typed_end).toBe(run_board_sound_enter.enter_wav)
		expect(trill_with(true, () => undefined).trill).toBeDefined()
	})
})

// joshuafolkken/kit#8917: the shown theme's NOTICE track is rendered ahead, as the board starts and as
// it switches to another, and a NOTICE sounds nothing while the sound is off.
describe('run_board_live.trill_of NOTICE', () => {
	it('renders the shown theme’s NOTICE ahead at the start and at a switch', () => {
		const shown: { theme: 'wopr' | 'flux' } = { theme: 'wopr' }
		const wopr = vi.spyOn(run_board_theme_defs.THEME_DEFS.wopr.score, 'notice')
		const flux = vi.spyOn(run_board_theme_defs.THEME_DEFS.flux.score, 'notice')

		wopr.mockReturnValue(undefined)
		flux.mockReturnValue(undefined)
		const trill = run_board_live.trill_of(
			{ typing_sound: heard().typing_sound },
			{ folded: undefined },
			() => shown.theme,
		)

		shown.theme = 'flux'
		trill?.set(true, LEFT_MS)

		expect([wopr.mock.calls.length, flux.mock.calls.length]).toStrictEqual([1, 1])
		vi.restoreAllMocks()
	})

	it('sounds no NOTICE while the sound is off', () => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)

		vi.spyOn(run_board_theme_defs.THEME_DEFS.flux.score, 'notice').mockReturnValue(ENTER_FILE)
		trill_with(false, () => undefined).trill?.event?.('notice', 1)

		expect(start).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})
})

// joshuafolkken/kit#8917: every way the board ends — a key in its ending, Ctrl-C twice, the terminal
// closed, a signal — reaches its one leave, which stops every sound the board started.
describe('run_board_live.watch leave', () => {
	it('stops every sound the board started as it leaves', async () => {
		const stop_all = vi
			.spyOn(run_board_sound_player, 'stop_all')
			.mockImplementation(() => undefined)
		const { ports, leaves } = run_board_fixture.harness(undefined, [])

		await expect(run_board_live.watch(ports, undefined)).rejects.toBe(run_board_fixture.STOPPED)
		leaves[0]?.()

		expect(stop_all).toHaveBeenCalledOnce()
		vi.restoreAllMocks()
	})
})

describe('run_board_live.typed_end_of', () => {
	it('plays the bttf ENTER WAV once', () => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)
		const write = vi.spyOn(run_board_sound_wav, 'resolved_samples').mockReturnValue(ENTER_FILE)

		run_board_live.typed_end_of('flux')()

		expect(write.mock.calls[0]?.[0].name).toBe(run_board_sound_enter.NAME)
		expect(start.mock.calls.map((call) => call[0])).toStrictEqual([ENTER_FILE])
		start.mockRestore()
		write.mockRestore()
	})

	// The typing voice falls silent where no player starts; the bell is a cue's fallback alone.
	it('rings no bell where no player starts', () => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)

		vi.spyOn(run_board_sound_wav, 'resolved_samples').mockReturnValue(ENTER_FILE)
		const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		run_board_live.typed_end_of('flux')()
		start.mock.calls[0]?.[1].failed()

		expect(out).not.toHaveBeenCalled()
		vi.restoreAllMocks()
	})

	it('plays the wopr typed end once', () => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)

		vi.spyOn(run_board_theme_defs.THEME_DEFS.wopr, 'typed_end').mockReturnValue(ENTER_FILE)
		run_board_live.typed_end_of('wopr')()

		expect(start.mock.calls.map((call) => call[0])).toStrictEqual([ENTER_FILE])
		vi.restoreAllMocks()
	})

	it.each(['trace', undefined] as const)('plays nothing in %s', (theme) => {
		const start = vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)

		run_board_live.typed_end_of(theme)()

		expect(start).not.toHaveBeenCalled()
		start.mockRestore()
	})
})

interface FreshTypedEnd {
	typed_end: () => void
	pcm: MockInstance
	start: MockInstance
}

// A fresh process's bttf typed end, its WAV written to a temporary directory and no player started.
async function fresh_typed_end(): Promise<FreshTypedEnd> {
	vi.resetModules()
	const { run_board_live: live } = await import('./run-board-live')
	const { run_board_sound_dtmf: dtmf } = await import('./run-board-sound-dtmf')
	const { run_board_sound_player: player } = await import('./run-board-sound-player')
	const { usage_state_path } = await import('#scripts/usage/usage-state-path')

	vi.spyOn(usage_state_path, 'sounds').mockReturnValue(create_directory('josh-typed-end-'))

	return {
		typed_end: live.typed_end_of('flux'),
		pcm: vi.spyOn(dtmf, 'pcm'),
		start: vi.spyOn(player, 'start').mockImplementation(() => undefined),
	}
}

// joshuafolkken/kit#8897: a process synthesizes the ENTER WAV on its first typed end only.
describe('run_board_live.typed_end_of resolution', () => {
	it('ac-981052aa synthesizes the bttf ENTER WAV once over two typed ends', async () => {
		const { typed_end, pcm, start } = await fresh_typed_end()

		typed_end()
		typed_end()

		expect(pcm).toHaveBeenCalledOnce()
		expect(start).toHaveBeenCalledTimes(2)
		expect(start.mock.calls[1]?.[0]).toBe(start.mock.calls[0]?.[0])
		vi.restoreAllMocks()
	})
})
