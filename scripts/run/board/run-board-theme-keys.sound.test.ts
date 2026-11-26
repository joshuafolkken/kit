import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { KeyReading, KeyTaker } from './run-board-keys'
import { run_board_sound_player } from './run-board-sound-player'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_theme_keys, type KeyHolder, type ThemeKeyPorts } from './run-board-theme-keys'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import type { ThemeRun } from './run-board-theme-run'

// joshuafolkken/kit#8917: the keys' sound. Entering or leaving demo mode and every demo key end every
// sound playing; an opening a key skips ends its sound and closes with the board appearing once, and
// one played through never closes again. No sound plays: the player is stubbed and its calls kept.

const { claim_of, skip_opening } = run_board_theme_keys
const { VIEW, base_canvas, ticking_run } = run_board_theme_layer_fixture
const { score } = run_board_theme_defs.THEME_DEFS.wopr
const NOW_MS = 20_000
const APPEAR_WAV = 'appear.wav'

interface Keys {
	holder: KeyHolder
	press: (chunk: string) => void
}

interface Player {
	start: MockInstance<typeof run_board_sound_player.start>
	stop_all: MockInstance<typeof run_board_sound_player.stop_all>
}

const player: Player = {
	start: vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined),
	stop_all: vi.spyOn(run_board_sound_player, 'stop_all').mockImplementation(() => undefined),
}

vi.spyOn(score, 'appear').mockReturnValue(APPEAR_WAV)

function keys_of(): Keys {
	const held: { taker: KeyTaker | undefined } = { taker: undefined }
	const keys: KeyReading = {
		folded: undefined,
		sound: () => true,
		intercept: (on_key) => {
			held.taker = on_key

			return () => {
				if (held.taker === on_key) held.taker = undefined
			}
		},
	}

	return { holder: { keys }, press: (chunk) => held.taker?.(chunk) }
}

function ports_of(keys: Keys): ThemeKeyPorts {
	return {
		now: () => NOW_MS,
		sleep: async () => undefined,
		save: () => undefined,
		keys: () => keys.holder.keys,
	}
}

// A run past its opening whose theme was built over the fixture's base.
function built_run(): ThemeRun {
	const run = ticking_run(0)

	run_board_theme_layer.theme_layer(run, VIEW).draw(base_canvas(), NOW_MS)

	return run
}

function appeared(): number {
	return player.start.mock.calls.filter(([file]) => file === APPEAR_WAV).length
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('run_board_theme_keys demo mode sound', () => {
	it('ends every sound as demo mode is entered, at each demo key and as it is left', () => {
		const keys = keys_of()
		const claim = claim_of(built_run(), keys.holder, ports_of(keys))

		claim('/')
		expect(player.stop_all).toHaveBeenCalledTimes(1)

		keys.press('a')
		keys.press('2')
		expect(player.stop_all).toHaveBeenCalledTimes(3)

		keys.press('/')
		expect(player.stop_all).toHaveBeenCalledTimes(4)
	})

	it('closes a demo opening another key cut short with the board appearing once', () => {
		const keys = keys_of()
		const claim = claim_of(built_run(), keys.holder, ports_of(keys))

		claim('/')
		keys.press('q')
		keys.press('a')

		expect(appeared()).toBe(1)
	})
})

describe('run_board_theme_keys.skip_opening sound', () => {
	it('ends the opening’s sound and sounds the board appearing once', () => {
		const run = built_run()
		const keys = keys_of()

		run.part = { name: 'opening', start_ms: NOW_MS }
		skip_opening(run, keys.holder)
		keys.press('x')
		keys.press('y')

		expect(player.stop_all).toHaveBeenCalledOnce()
		expect(appeared()).toBe(1)
	})

	it('sounds nothing more for an opening that played through', () => {
		const run = built_run()
		const keys = keys_of()

		run.part = { name: 'opening', start_ms: NOW_MS }
		skip_opening(run, keys.holder)
		run.release?.()
		run.release = undefined
		run.part = undefined
		keys.press('x')

		expect(appeared()).toBe(0)
	})
})
