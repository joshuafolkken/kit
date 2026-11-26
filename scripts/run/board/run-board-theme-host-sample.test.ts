import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_sample } from './run-board-theme-host-sample'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'
import type { Grid, ThemeFactory, ThemeModule, ThemeState } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the confirmed theme demo's sample events, and the recorded demo frames
// and the frame check that theme ports are held to.

const { NOTICE_ISSUE, NOTICE_TEXT, PROGRESS_TEXTS, demo_events } = run_board_theme_host_sample
const { HOST, snap_text } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { check_problems, demo_snaps, frame_at, snap_mismatches } = run_board_theme_host_snap_fixture
const { expect_demo_check, expect_demo_snaps, theme_of } = run_board_theme_host_snap_fixture

const GREY = '1;1;1'
const QUIET: ThemeModule = {
	name: 'QUIET',
	colors: {
		body: GREY,
		rule: GREY,
		ok: GREY,
		red: GREY,
		warn: GREY,
		hi: GREY,
		type: GREY,
		notice: GREY,
	},
	draw: () => undefined,
}

function first_line(text = ''): string {
	return text.split('\n', 1).join('')
}

describe('run_board_theme_host_sample.demo_events', () => {
	const lane = 'the lane row'
	const events = demo_events(lane)

	it('times each event as the demo does', () => {
		expect(events.n).toMatchObject({
			notice: [{ start: 10, text: NOTICE_TEXT }],
			progress: [],
			row: [],
			last: 225,
		})
		expect(events.p.progress).toStrictEqual([
			{ start: 10, ...PROGRESS_TEXTS[0] },
			{ start: 110, ...PROGRESS_TEXTS[1] },
		])
		expect(events.r.row).toStrictEqual([{ start: 10, text: lane }])
		expect(events.a.progress.map(({ start }) => start)).toStrictEqual([165, 410])
		expect(events.i).toMatchObject({ notice: [], progress: [], row: [], last: 200 })
	})

	it('plays the opening and the ending as parts', () => {
		expect(events.o.part).toBe('opening')
		expect(events.x.part).toBe('ending')
	})

	it('names one issue in the notice and both progress lines', () => {
		const texts = [NOTICE_TEXT, ...PROGRESS_TEXTS.map(({ text }) => text)]

		expect(texts.every((text) => text.includes(NOTICE_ISSUE))).toBe(true)
	})
})

function event_of(state: ThemeState): string {
	if (state.event.notice.length > 0) return 'n'
	if (state.event.progress.length > 0) return 'p'

	return state.event.row.length > 0 ? 'r' : 'i'
}

// A theme that lays the demo's recorded text of theme `theme_key` for the event and tick it draws:
// the snap helpers must then find no difference.
function replay_of(theme_key: number): ThemeFactory {
	const texts = new Map(demo_snaps(theme_key).map(({ key, text }) => [key.slice(1), text]))

	return (api) => {
		function lay(grid: Grid, key: string): void {
			const lines = texts.get(key)?.split('\n') ?? []

			for (const [y, line] of lines.entries()) grid[y] = row_of(line, 'body', api.layout.w)
		}

		return {
			...QUIET,
			draw: (grid, state, tick) => lay(grid, `${event_of(state)}${tick}`),
			opening: { ticks: 1, note: '', draw: (grid, tick) => lay(grid, `o${tick}`) },
			ending: { ticks: 1, note: '', draw: (grid, tick) => lay(grid, `x${tick}`) },
		}
	}
}

describe('run_board_theme_host_snap_fixture', () => {
	it('holds 72 demo frames of 60 rows for each theme key 1-7', () => {
		for (const key of [1, 2, 3, 4, 5, 6, 7]) {
			const snaps = demo_snaps(key)

			expect(snaps).toHaveLength(72)
			expect(snaps.every(({ text }) => text.split('\n').length === HOST.layout.h)).toBe(true)
		}
	})

	it('reads a frame the demo way and reports a theme that does not draw it', () => {
		const head = first_line(snap_text(frame_at(QUIET, 'i', 0)))
		const demo_head = first_line(demo_snaps(4)[0]?.text)
		const mismatches = snap_mismatches(() => QUIET, 4)

		// The board's name, top left, is the theme's own; past it the idle header is the board's.
		expect(head.slice(0, 16)).toBe('> josh          ')
		expect(head.slice(16)).toBe(demo_head.slice(16))
		expect(mismatches.length).toBeGreaterThan(0)
		expect(mismatches[0]?.expected).not.toBe(mismatches[0]?.actual)
	})

	it('finds no difference for a theme that draws the demo’s own frames', () => {
		const keys = [1, 2, 3, 4, 5, 6, 7]

		for (const key of keys) expect_demo_snaps(replay_of(key), key)
		expect(keys.every((key) => snap_mismatches(replay_of(key), key).length === 0)).toBe(true)
	})

	it('builds every frame of every event screen-sized for a theme that draws nothing', () => {
		expect(theme_of(() => QUIET)).toBe(QUIET)
		expect(check_problems(() => QUIET)).toStrictEqual([])
		expect_demo_check(() => ({ ...QUIET, lasts: { i: 20 } }))
	}, 60_000)
})
