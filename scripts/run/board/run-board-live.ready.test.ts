import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_live } from './run-board-live'
import { run_board_live_sound } from './run-board-live-sound'
import { run_board_sound_player } from './run-board-sound-player'
import type { ResidentChild } from './run-board-sound-resident'
import type { TypingSound } from './run-board-sound-typing'
import { run_board_theme_registry } from './run-board-theme-registry'
import type { ThemeRun } from './run-board-theme-run'

// A real start holds the board's first frame until the resident player's output is open, so the opening
// — its picture, its bed, its typing trill — starts from the first frame drawn after the wait. No sound
// plays: the resident player the board opens is a fake child that never says it is open, and the
// player's own starts are stubbed.

const { LOCAL, START, STOPPED, harness, plan_titled } = run_board_fixture
const { READY_WAIT_MS } = run_board_live_sound
const TRILL: TypingSound = { set: () => undefined, stop: () => undefined }
// Sleeps enough for the first frame to be drawn, the board's clock standing still through them.
const SLEEPS = 20

// eslint-disable-next-line unicorn/prefer-event-target -- stands in for a spawned child, a Node EventEmitter
class FakeChild extends EventEmitter implements ResidentChild {
	readonly stdin = new PassThrough()
	readonly stdout = new PassThrough()
	readonly unref = vi.fn()
}

// The board's own `prepare` — called as its trill is made, before its first frame — opening the resident
// player on a fake child that never writes its first line, so it is still opening for ever.
function still_opening(): void {
	const { prepare } = run_board_sound_player
	const ports = { spawner: () => new FakeChild(), length_ms: () => 0, after: () => undefined }

	vi.spyOn(run_board_sound_player, 'prepare').mockImplementation(() => {
		prepare({ platform: 'darwin', ports })
	})
	vi.spyOn(run_board_sound_player, 'start').mockImplementation(() => undefined)
	vi.spyOn(run_board_sound_player, 'loop').mockImplementation(() => undefined)
}

// The theme run the board opens, kept as it is made.
function kept_run(): { current: ThemeRun | undefined } {
	const kept: { current: ThemeRun | undefined } = { current: undefined }
	const { run_of } = run_board_theme_registry

	vi.spyOn(run_board_theme_registry, 'run_of').mockImplementation((theme, color_depth) => {
		kept.current = run_of(theme, color_depth)

		return kept.current
	})

	return kept
}

// A sleep that moves the board's clock on by the first wait alone — the wait for the player — and stops
// the board after `SLEEPS` more; each wait asked for is kept.
function waiting(clock: { now_ms: number }, asked: Array<number>): (ms: number) => Promise<void> {
	return async (ms) => {
		asked.push(ms)
		if (asked.length === 1) clock.now_ms += ms
		if (asked.length > SLEEPS) throw STOPPED
	}
}

afterEach(() => {
	run_board_sound_player.close()
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('run_board_live.watch waiting for the resident player', () => {
	it('starts the opening on the first frame drawn after the wait', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		still_opening()
		const run = kept_run()
		const { ports, clock } = harness(LOCAL, [plan_titled('a')])
		const asked: Array<number> = []
		const board = { ...ports, typing_sound: TRILL, sleep: waiting(clock, asked) }

		await expect(run_board_live.watch(board, 'wopr')).rejects.toBe(STOPPED)

		expect(asked[0]).toBe(READY_WAIT_MS)
		expect(run.current?.part).toMatchObject({ name: 'opening', start_ms: START + READY_WAIT_MS })
	})
})
