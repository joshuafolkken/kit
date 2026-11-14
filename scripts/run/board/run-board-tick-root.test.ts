import { stripVTControlCharacters } from 'node:util'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#7524: a single run in the root checkout beside a running `backlogrun` keeps the
// `backlogrun` frame and adds its `🏠` row above the lanes, counted as no lane.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LANES_ICON, PHASE_ICONS, STATE_ICONS } = run_board_labels
const KIND = run_event_stream.EVENT_KIND
const ROOT = 7521
const LANE = 7530
const LANE_LIMIT = 6
const AT = new Date(START).toISOString()

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

// One lane of the `backlogrun` running, under a limit of six.
const CARRIED: LocalRead = {
	...LOCAL,
	events: [event(KIND.CHILD_LAUNCH, `#${String(LANE)} fullrun`)],
	lanes: [String(LANE)],
	occupied_count: 1,
	lane_limit: LANE_LIMIT,
	free_lanes: LANE_LIMIT - 1,
}

const ROOTED: LocalRead = {
	...CARRIED,
	root: {
		command: 'fullrun',
		issue: ROOT,
		events: [
			event(KIND.CHILD_LAUNCH, `#${String(ROOT)} fullrun`),
			event(KIND.LANE_PHASE, `#${String(ROOT)} implement`),
		],
	},
}

async function frame_of(local: LocalRead): Promise<Array<string>> {
	const { ports, frames } = harness(local, [])

	await tick(FRESH_STATE, ports)

	return stripVTControlCharacters(frames.at(-1) ?? '').split('\n')
}

// The header, up to its first blank line — the run's counts, 🔄 among them.
function header(lines: ReadonlyArray<string>): Array<string> {
	return lines.slice(0, lines.indexOf(''))
}

function index_of(lines: ReadonlyArray<string>, text: string): number {
	return lines.findIndex((line) => line.includes(text))
}

describe('run_board_tick.tick — a root single run beside a backlogrun', () => {
	it('draws the 🏠 rule and the run’s row with its phase above the lanes rule', async () => {
		const lines = await frame_of(ROOTED)
		const home = index_of(lines, '🏠 fullrun')
		const lanes = index_of(lines, `${LANES_ICON} lanes`)

		expect(home).toBeGreaterThan(-1)
		expect(lanes).toBeGreaterThan(home)
		expect(lines[home + 1]).toContain(String(ROOT))
		expect(lines[home + 1]).toContain(PHASE_ICONS.implement)
	})

	it('keeps the backlogrun header and lane rows', async () => {
		const lines = await frame_of(ROOTED)
		const plain = await frame_of(CARRIED)

		expect(lines[0]).toBe(plain[0])
		expect(lines[0]).toContain('backlogrun')
		expect(lines.slice(index_of(lines, `${LANES_ICON} lanes`))).toStrictEqual(
			plain.slice(index_of(plain, `${LANES_ICON} lanes`)),
		)
	})

	it('counts the root run in neither the lanes nor the header’s running children', async () => {
		const lines = await frame_of(ROOTED)
		const plain = await frame_of(CARRIED)
		const lanes = `${LANES_ICON} lanes 1/${String(LANE_LIMIT)}`

		expect(lines.some((line) => line.includes(lanes))).toBe(true)
		expect(header(lines)).toStrictEqual(header(plain))
		expect(header(lines).join('\n')).toContain(STATE_ICONS.running)
	})

	it('draws no 🏠 rule without a root run', async () => {
		const lines = await frame_of(CARRIED)

		expect(lines.some((line) => line.includes('🏠'))).toBe(false)
	})
})
