import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cells } from './run-board-cells'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture, type Stage } from './run-board-frame-fixture'
import { run_board_live } from './run-board-live'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'
import type { UsageMark } from './run-board-usage'

// joshuafolkken/kit#8401: every live refresh keeps the wargames rules dimmed — the theme restyles the
// board's own lines before the screen's control bytes are put in front of them.

const { IDLE_ROW, LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const { attributes_of, each_screen, is_synced_once, rule_cells, stage_log } =
	run_board_frame_fixture
const DIM_RULE_TRUE_COLOR = '38;2;31;118;113'
const THEMED = ['--theme', 'wargames']
// The bttf gauge's cell with all four lamps lit, as its idle green bars draw it.
const GAUGE_FULL_CELL = '⣿'
const USAGE: UsageMark = {
	at_ms: 0,
	processes: new Map(),
	lanes: new Map(),
	names: new Map(),
	parents: new Map(),
	unread: new Set(),
	folded: new Set(),
	cores: 1,
	total_bytes: 1000,
}
const RATE_LIMIT: GithubRateLimit = {
	core: { remaining: 4321, limit: 5000, reset_ms: 0 },
	graphql: undefined,
}
// Enough board time for the opening, its reveal and a few redraws on the second to pass.
const STOP_AFTER_MS = 5000

// A sleep that moves the board's clock on by what it waits, and stops the board once enough has passed.
function clocked(clock: { now_ms: number }): (ms: number) => Promise<void> {
	const stop_at = clock.now_ms + STOP_AFTER_MS

	return async (ms) => {
		clock.now_ms += ms
		if (clock.now_ms > stop_at) throw STOPPED
	}
}

async function instant(): Promise<void> {
	await Promise.resolve()
}

type Ports = ReturnType<typeof harness>['ports']

async function watched(ports: Ports): Promise<unknown> {
	return await run_board_live.watch(ports, 'wargames')
}

// A frame written after the opening reveal (joshuafolkken/kit#8826): its bytes, whether it is the first
// a redraw wrote, and what the screen showed after it.
interface Refresh {
	write: string
	is_redraw: boolean
	rule_styles: Array<string>
	has_rain: boolean
}

// The matrix rain's half-width katakana.
const RAIN = /[ｦ-ﾝ]/u

function refresh_of(write: string, is_redraw: boolean, cells: Cells): Refresh {
	const lines = run_board_frame_fixture.lines_of(cells)

	return {
		write,
		is_redraw,
		rule_styles: rule_cells(cells).map(({ sgr }) => sgr),
		has_rain: RAIN.test(lines.join('\n')),
	}
}

// The indices of the first write each redraw after the opening made.
function redraw_writes(stages: ReadonlyArray<Stage>): Set<number> {
	return new Set(stages.filter(({ stage }) => stage === 'redraw').map(({ written }) => written))
}

// The frames written after the opening reveal, each with the screen it left; the leave is not one.
async function refreshes(
	force_color: string,
	run: (ports: Ports) => Promise<unknown> = watched,
): Promise<Array<Refresh>> {
	vi.stubEnv('FORCE_COLOR', force_color)
	const { ports, frames, clock } = harness(LOCAL, [plan_titled('a')])
	const { stages, enter_stage } = stage_log(frames)
	const seen: Array<Refresh> = []

	await expect(
		run({ ...ports, enter_stage, sleep: clocked(clock), intro_sleep: instant }),
	).rejects.toBe(STOPPED)
	const opened = stages.find(({ stage }) => stage === 'turn')?.written ?? frames.length
	const redraws = redraw_writes(stages)

	each_screen(frames.slice(0, -1), (cells, index) => {
		const write = frames[index] ?? ''

		if (index >= opened) seen.push(refresh_of(write, redraws.has(index), cells))
	})

	return seen
}

// Whether every refresh left the rules on screen, each in `is_dimmed`'s look.
function is_ruled(written: ReadonlyArray<Refresh>, is_dimmed: (sgr: string) => boolean): boolean {
	return written.every(
		({ rule_styles }) => rule_styles.length > 0 && rule_styles.every((sgr) => is_dimmed(sgr)),
	)
}

function is_true_color_dim(sgr: string): boolean {
	return attributes_of(sgr).fg === DIM_RULE_TRUE_COLOR
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_live.watch wargames refresh', () => {
	it('dims the rules on every refresh in 24-bit color', async () => {
		const written = await refreshes('3')

		expect(written.filter(({ is_redraw }) => is_redraw).length).toBeGreaterThan(0)
		expect(is_ruled(written, is_true_color_dim)).toBe(true)
	})

	it('dims the rules on every refresh in named color', async () => {
		const written = await refreshes('2')

		expect(written.filter(({ is_redraw }) => is_redraw).length).toBeGreaterThan(0)
		expect(is_ruled(written, (sgr) => attributes_of(sgr).is_dim)).toBe(true)
	})

	it('dims the rules on every refresh of the board run --theme wargames draws', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', undefined)
		const written = await refreshes('3', async (ports) => await run_board_cli.run(THEMED, ports))

		expect(written.filter(({ is_redraw }) => is_redraw).length).toBeGreaterThan(0)
		expect(is_ruled(written, is_true_color_dim)).toBe(true)
	})

	// joshuafolkken/kit#8826: a refresh writes only the cells that changed, in one synchronized write.
	it('writes every refresh in one synchronized write', async () => {
		const written = await refreshes('3')

		expect(written.length).toBeGreaterThan(0)
		expect(written.every(({ write }) => is_synced_once(write))).toBe(true)
	})
})

// joshuafolkken/kit#8674: a live bttf board draws its flux panel though its rows do not type.
describe('run_board_live.watch bttf flux panel', () => {
	it('draws the flux gauge on the live board', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames, clock, read_usage } = harness({ ...LOCAL, throughput: [IDLE_ROW] }, [
			plan_titled('a'),
		])

		// The usage cells widen the rules to the pane, room for the flux figure beside the lamps.
		read_usage.mockResolvedValue(USAGE)

		// joshuafolkken/kit#8712: the rate limit read draws the GitHub row the figure's last row sits on.
		const read_rate_limit = vi.fn(async () => RATE_LIMIT)

		await expect(
			run_board_live.watch(
				{ ...ports, read_rate_limit, sleep: clocked(clock), intro_sleep: instant },
				'bttf',
			),
		).rejects.toBe(STOPPED)

		expect(read_rate_limit).toHaveBeenCalled()
		expect(frames.join('')).toContain(GAUGE_FULL_CELL)
	})
})

// joshuafolkken/kit#8796: a live matrix refresh and the rain the spin draws back over it go out in one
// synchronized write, and leaving writes whatever is held first. joshuafolkken/kit#8826: a refresh is
// composed with every layer before the one write, so the rain on screen never blinks off with it.
const LEAVE = run_board_screen.screen_of('live').leave

// Whether every redraw that found rain on screen left rain on it.
function keeps_rain(written: ReadonlyArray<Refresh>): boolean {
	return written.every(
		(refresh, index) =>
			!refresh.is_redraw || !(written[index - 1]?.has_rain ?? false) || refresh.has_rain,
	)
}

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

describe('run_board_live.watch matrix refresh', () => {
	it('writes the rain drawn back over a refresh in its one synchronized write', async () => {
		const written = await refreshes(
			'3',
			async (ports) => await run_board_live.watch(ports, 'matrix'),
		)
		const redraws = written.filter(
			({ is_redraw }, index) => is_redraw && written[index - 1]?.has_rain,
		)

		expect(redraws.length).toBeGreaterThan(0)
		expect(keeps_rain(written)).toBe(true)
		expect(written.every(({ write }) => is_synced_once(write))).toBe(true)
	})

	it('writes a whole frame before leaving the screen', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames, clock, leaves } = harness(LOCAL, [plan_titled('a')])
		const { stages, enter_stage } = stage_log(frames)
		const typing_sound = leaving_on_refresh(stages, leaves)

		await expect(
			run_board_live.watch(
				{ ...ports, enter_stage, typing_sound, sleep: clocked(clock), intro_sleep: instant },
				'matrix',
			),
		).rejects.toBe(STOPPED)

		// The theme colors every write, the leave among them.
		const left = frames.findIndex((frame) => frame.includes(LEAVE))

		expect(left).toBeGreaterThan(0)
		expect(is_synced_once(frames[left - 1] ?? '')).toBe(true)
	})
})
