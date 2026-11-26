import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cells } from './run-board-cells'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture, type Stage } from './run-board-frame-fixture'
import { run_board_live } from './run-board-live'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'

// joshuafolkken/kit#8401: every live refresh keeps the rules dimmed — the theme restyles the board's own
// lines before the screen's control bytes are put in front of them. joshuafolkken/kit#8917: without
// 24-bit color a themed board is the board in no theme; in it the theme host draws the board
// (`run-board-theme-layer.test.ts`).

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const { attributes_of, each_screen, is_synced_once, rule_cells, stage_log } =
	run_board_frame_fixture
const THEMED = ['--theme', 'wopr']
// Enough board time for the opening and a few redraws on the second to pass.
const STOP_AFTER_MS = 5000

// A sleep that moves the board's clock on by what it waits, and stops the board once enough has passed.
function clocked(clock: { now_ms: number }): (ms: number) => Promise<void> {
	const stop_at = clock.now_ms + STOP_AFTER_MS

	return async (ms) => {
		clock.now_ms += ms
		if (clock.now_ms > stop_at) throw STOPPED
	}
}

type Ports = ReturnType<typeof harness>['ports']

async function watched(ports: Ports): Promise<unknown> {
	return await run_board_live.watch(ports, 'wopr')
}

// A frame written after the first turn (joshuafolkken/kit#8826): its bytes, whether it is the first a
// redraw wrote, and the rules' styles on the screen it left.
interface Refresh {
	write: string
	is_redraw: boolean
	rule_styles: Array<string>
}

function refresh_of(write: string, is_redraw: boolean, cells: Cells): Refresh {
	return { write, is_redraw, rule_styles: rule_cells(cells).map(({ sgr }) => sgr) }
}

// The indices of the first write each redraw made.
function redraw_writes(stages: ReadonlyArray<Stage>): Set<number> {
	return new Set(stages.filter(({ stage }) => stage === 'redraw').map(({ written }) => written))
}

// The frames written after the first turn began, each with the screen it left; the leave is not one.
async function refreshes(
	force_color: string,
	run: (ports: Ports) => Promise<unknown> = watched,
): Promise<Array<Refresh>> {
	vi.stubEnv('FORCE_COLOR', force_color)
	const { ports, frames, clock } = harness(LOCAL, [plan_titled('a')])
	const { stages, enter_stage } = stage_log(frames)
	const seen: Array<Refresh> = []

	await expect(run({ ...ports, enter_stage, sleep: clocked(clock) })).rejects.toBe(STOPPED)
	const opened = stages.find(({ stage }) => stage === 'turn')?.written ?? frames.length
	const redraws = redraw_writes(stages)

	each_screen(frames.slice(0, -1), (cells, index) => {
		const write = frames[index] ?? ''

		if (index >= opened) seen.push(refresh_of(write, redraws.has(index), cells))
	})

	return seen
}

// Whether every refresh left the rules on screen, each dimmed.
function is_dim_ruled(written: ReadonlyArray<Refresh>): boolean {
	return written.every(
		({ rule_styles }) =>
			rule_styles.length > 0 && rule_styles.every((sgr) => attributes_of(sgr).is_dim),
	)
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_live.watch themed refresh', () => {
	// Without 24-bit color the board is the board in no theme, its rules dimmed.
	it('dims the rules on every refresh in named color', async () => {
		const written = await refreshes('2')

		expect(written.filter(({ is_redraw }) => is_redraw).length).toBeGreaterThan(0)
		expect(is_dim_ruled(written)).toBe(true)
	})

	it('dims the rules on every refresh of the board run --theme wopr draws in named color', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', undefined)
		const written = await refreshes('2', async (ports) => await run_board_cli.run(THEMED, ports))

		expect(written.filter(({ is_redraw }) => is_redraw).length).toBeGreaterThan(0)
		expect(is_dim_ruled(written)).toBe(true)
	})

	// joshuafolkken/kit#8826: a refresh writes only the cells that changed, in one synchronized write.
	it('writes every refresh in one synchronized write', async () => {
		const written = await refreshes('3')

		expect(written.length).toBeGreaterThan(0)
		expect(written.every(({ write }) => is_synced_once(write))).toBe(true)
	})
})

// joshuafolkken/kit#8796: leaving writes whatever is held first.
const LEAVE = run_board_screen.screen_of('live').leave

// A typing sound that leaves the screen right after the first frame of the second redraw: a frame sets
// the sound once it is written.
function leaving_on_refresh(
	stages: ReadonlyArray<Stage>,
	leaves: ReadonlyArray<() => void>,
): TypingSound {
	return {
		set: () => {
			if (stages.filter(({ stage }) => stage === 'redraw').length > 1) leaves[0]?.()
		},
		// The board stops its sound on the way out; nothing to stop here.
		stop: () => undefined,
	}
}

describe('run_board_live.watch leaving a themed board', () => {
	it('writes a whole frame before leaving the screen', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames, clock, leaves } = harness(LOCAL, [plan_titled('a')])
		const { stages, enter_stage } = stage_log(frames)
		const typing_sound = leaving_on_refresh(stages, leaves)

		await expect(
			run_board_live.watch({ ...ports, enter_stage, typing_sound, sleep: clocked(clock) }, 'trace'),
		).rejects.toBe(STOPPED)

		const left = frames.findIndex((frame) => frame.includes(LEAVE))

		expect(left).toBeGreaterThan(0)
		expect(is_synced_once(frames[left - 1] ?? '')).toBe(true)
	})
})
