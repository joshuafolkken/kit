import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { EventKey, FinalGrid, ThemeFactory, ThemeModule } from './run-board-theme-host-types'

// The confirmed theme demo's frames as a theme port's test checks them (joshuafolkken/kit#8917).
// `__snapshots__/run-board-theme-host-snaps.jsonl.gz` holds, one JSON line `{ key, text }` a frame,
// the demo's DEMO_SNAP text (60 rows) for each theme key 1-7: events i, p, r, n at a spread of ticks
// and eight ticks spread over the opening (o) and the ending (x). They were recorded from
// `.josh/tmp/scratch/fixed-v21-theme-demo.mjs` with `DEMO_SNAP="<key>,…" DEMO_SNAP_ROWS=60` and no
// terminal (199 columns, 60 rows); the recording script was
// `.josh/tmp/handoff-halfrun-1795540927344/snaps-record.mjs` (`node <script>` from the root).

const { HOST, snap_text } = run_board_theme_host_fixture
const { frame_of, part_frame_of, part_of } = run_board_theme_host_frame
const { GAP_TICKS, NORMAL_FROM } = run_board_theme_host_state

const SNAPS_URL = new URL('__snapshots__/run-board-theme-host-snaps.jsonl.gz', import.meta.url)
const SNAP_KEY = /^(?<theme>\d)(?<event>[a-z])(?<tick>\d+)$/u
const CHECK_EVENTS: ReadonlyArray<DemoKey> = ['i', 'p', 'r', 'n', 'o', 'x']
const DEMO_KEYS: ReadonlySet<string> = new Set(CHECK_EVENTS)

interface DemoSnap {
	key: string
	theme: number
	event: DemoKey
	tick: number
	text: string
}

function is_demo_key(value: string): value is DemoKey {
	return DEMO_KEYS.has(value)
}

function snap_of(line: string): DemoSnap {
	const { key, text } = JSON.parse(line) as { key: string; text: string }
	const groups = SNAP_KEY.exec(key)?.groups ?? {}
	const event = groups['event'] ?? ''

	if (!is_demo_key(event)) throw new Error(`Not a demo snap key: ${key}`)

	return { key, theme: Number(groups['theme']), event, tick: Number(groups['tick']), text }
}

const SNAPS = gunzipSync(readFileSync(SNAPS_URL))
	.toString('utf8')
	.split('\n')
	.filter((line) => line !== '')
	.map((line) => snap_of(line))

// The demo's snaps of the theme with key `theme_key` (1-7).
function demo_snaps(theme_key: number): Array<DemoSnap> {
	return SNAPS.filter(({ theme }) => theme === theme_key)
}

// A theme built for the demo's board.
function theme_of(factory: ThemeFactory): ThemeModule {
	return factory(HOST.api)
}

// The frame of `event` at `tick` on the demo's board: an opening or ending drawn over the idle board.
function frame_at(theme: ThemeModule, event: DemoKey, tick: number): FinalGrid {
	const timeline = HOST.events[event]

	if (timeline.part) return part_frame_of(theme, HOST.api, timeline.part, tick)

	return frame_of(theme, HOST.api, timeline, tick)
}

interface SnapMismatch {
	key: string
	expected: string
	actual: string
}

// What a theme's snaps leave out of the comparison: the text of snap `key` with the cells a port
// draws as its own (blanked alike in the demo's and the port's).
type SnapMask = (key: string, text: string) => string

function unmasked(_key: string, text: string): string {
	return text
}

function snap_mismatches(
	factory: ThemeFactory,
	theme_key: number,
	mask: SnapMask = unmasked,
): Array<SnapMismatch> {
	const theme = theme_of(factory)
	const compared = demo_snaps(theme_key).map(({ key, event, tick, text }) => ({
		key,
		expected: mask(key, text),
		actual: mask(key, snap_text(frame_at(theme, event, tick))),
	}))

	return compared.filter(({ expected, actual }) => expected !== actual)
}

// Every stored snap of `theme_key` is the frame the theme draws, character for character. On a
// mismatch the first differing frame shows as a diff, its message naming every differing key.
function expect_demo_snaps(
	factory: ThemeFactory,
	theme_key: number,
	mask: SnapMask = unmasked,
): void {
	const total = demo_snaps(theme_key).length
	const mismatches = snap_mismatches(factory, theme_key, mask)
	const keys = mismatches.map(({ key }) => key)
	const [first] = mismatches

	expect(total).toBeGreaterThan(0)

	if (first) {
		const counted = `${String(keys.length)} of ${String(total)}`
		const message = `demo snap ${first.key}: ${counted} differ (${keys.join(' ')})`

		expect(first.actual, message).toBe(first.expected)
	}

	expect(keys).toStrictEqual([])
}

function last_of(theme: ThemeModule, event: EventKey): number {
	return theme.lasts?.[event] ?? HOST.events[event].last
}

// The demo's DEMO_CHECK ticks of `event`: an event for its length and the normal display after it
// (counted from NORMAL_FROM), an opening or ending for its own ticks.
function check_ticks(theme: ThemeModule, event: DemoKey): Array<number> {
	const { part } = HOST.events[event]

	if (part) {
		return Array.from({ length: part_of(theme, HOST.layout, part).ticks }, (_, tick) => tick)
	}

	if (event === 'o' || event === 'x') return []
	const last = last_of(theme, event)

	return Array.from({ length: last + GAP_TICKS }, (_, step) =>
		step < last ? step : NORMAL_FROM + step - last,
	)
}

// What is wrong with a frame's size: it is the screen's rows by its columns.
function size_problem(frame: FinalGrid): string | undefined {
	if (frame.length !== HOST.layout.h) return `${String(frame.length)} rows`
	const wrong = frame.findIndex((row) => row.length !== HOST.layout.w)

	return wrong === -1 ? undefined : `row ${String(wrong)} is ${String(frame[wrong]?.length)} cells`
}

function built(theme: ThemeModule, event: DemoKey, tick: number): FinalGrid {
	try {
		return frame_at(theme, event, tick)
	} catch (error) {
		throw new Error(`frame ${event}${String(tick)} threw`, { cause: error })
	}
}

// The demo's DEMO_CHECK: every frame of every event built, each the screen's size exactly.
function event_problems(theme: ThemeModule, event: DemoKey): Array<string> {
	const problems: Array<string> = []

	for (const tick of check_ticks(theme, event)) {
		const problem = size_problem(built(theme, event, tick))

		if (problem) problems.push(`${event}${String(tick)}: ${problem}`)
	}

	return problems
}

function check_problems(factory: ThemeFactory): Array<string> {
	const theme = theme_of(factory)

	return CHECK_EVENTS.flatMap((event) => event_problems(theme, event))
}

function expect_demo_check(factory: ThemeFactory): void {
	expect(check_problems(factory)).toStrictEqual([])
}

const run_board_theme_host_snap_fixture = {
	CHECK_EVENTS,
	check_problems,
	check_ticks,
	demo_snaps,
	expect_demo_check,
	expect_demo_snaps,
	frame_at,
	last_of,
	snap_mismatches,
	theme_of,
}

export { run_board_theme_host_snap_fixture }
export type { DemoSnap, SnapMask, SnapMismatch }
