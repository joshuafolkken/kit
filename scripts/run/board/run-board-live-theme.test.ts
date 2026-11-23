import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_live } from './run-board-live'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_screen } from './run-board-screen'
import type { TypingSound } from './run-board-sound-typing'
import type { UsageMark } from './run-board-usage'

// joshuafolkken/kit#8401: every live refresh keeps the wargames rules dimmed — the theme restyles the
// board's own lines before the screen's control bytes are put in front of them.

const { IDLE_ROW, LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const ESC = '\u{1B}'
const SYNC_START = `${ESC}[?2026h`
const SYNC_END = `${ESC}[?2026l`
const REFRESH_START = `${SYNC_START}${ESC}[H${ESC}[K`
const ERASE_LINE = `\n${ESC}[K`
const DIM_RULE_TRUE_COLOR = `${ESC}[38;2;31;118;113m-`
const DIM_RULE_NAMED = `${ESC}[2m-`
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

// The frames the redraw wrote after the opening reveal, each between the screen's own control bytes.
async function refreshes(
	force_color: string,
	run: (ports: Ports) => Promise<unknown> = watched,
): Promise<Array<string>> {
	vi.stubEnv('FORCE_COLOR', force_color)
	const { ports, frames, clock } = harness(LOCAL, [plan_titled('a')])

	await expect(run({ ...ports, sleep: clocked(clock), intro_sleep: instant })).rejects.toBe(STOPPED)

	return frames.filter((frame) => frame.startsWith(REFRESH_START))
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_live.watch wargames refresh', () => {
	it('dims the rules on every refresh in 24-bit color', async () => {
		const written = await refreshes('3')

		expect(written.length).toBeGreaterThan(0)
		for (const frame of written) expect(frame).toContain(DIM_RULE_TRUE_COLOR)
	})

	it('dims the rules on every refresh in named color', async () => {
		const written = await refreshes('2')

		expect(written.length).toBeGreaterThan(0)
		for (const frame of written) expect(frame).toContain(DIM_RULE_NAMED)
	})

	it('dims the rules on every refresh of the board run --theme wargames draws', async () => {
		vi.stubEnv('JOSH_BOARD_THEME', undefined)
		const written = await refreshes('3', async (ports) => await run_board_cli.run(THEMED, ports))

		expect(written.length).toBeGreaterThan(0)
		for (const frame of written) expect(frame).toContain(DIM_RULE_TRUE_COLOR)
	})

	it('still puts the screen control bytes on every refresh', async () => {
		const written = await refreshes('3')

		expect(written.length).toBeGreaterThan(0)

		for (const frame of written) {
			expect(frame).toContain(ERASE_LINE)
			expect(frame.endsWith(SYNC_END)).toBe(true)
		}
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
// synchronized write, and leaving writes whatever is held first.
const LEAVE = run_board_screen.screen_of('live').leave
// A wipe below the board followed by a cursor move: the rain drawn back after the refresh's lines.
// eslint-disable-next-line no-control-regex
const RAIN_AFTER_ERASE = /\u{1B}\[J[^]*\u{1B}\[\d+;\d+H/u

// A typing sound that leaves the screen while a redrawn frame is held: a frame sets the sound right
// after drawing into the held joint, so nothing reached the terminal since the last set, where a spin
// turn writes its bytes before its own set.
function leaving_on_held_frame(
	frames: ReadonlyArray<string>,
	leaves: ReadonlyArray<() => void>,
): TypingSound {
	let written_at_set = -1

	return {
		set: () => {
			const has_refreshed = frames.some((frame) => frame.startsWith(REFRESH_START))

			if (has_refreshed && frames.length === written_at_set) leaves[0]?.()
			written_at_set = frames.length
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

		expect(written.some((frame) => RAIN_AFTER_ERASE.test(frame))).toBe(true)
		for (const frame of written) expect(frame.split(SYNC_END)).toHaveLength(2)
	})

	it('writes the held refresh before leaving the screen', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, frames, clock, leaves } = harness(LOCAL, [plan_titled('a')])
		const typing_sound = leaving_on_held_frame(frames, leaves)

		await expect(
			run_board_live.watch(
				{ ...ports, typing_sound, sleep: clocked(clock), intro_sleep: instant },
				'matrix',
			),
		).rejects.toBe(STOPPED)

		// The theme colors every write, the leave among them.
		const left = frames.findIndex((frame) => frame.includes(LEAVE))

		expect(left).toBeGreaterThan(0)
		expect(frames[left - 1]?.startsWith(REFRESH_START)).toBe(true)
	})
})
