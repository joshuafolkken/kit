import { stripVTControlCharacters } from 'node:util'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import { run_board_labels } from './run-board-labels'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#7524: a single run in the root checkout beside a running `backlogrun` keeps the
// `backlogrun` frame and adds its `🏠` row above the lanes, counted as no lane.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LANES_ICON, PHASE_ICONS, STATE_ICONS, WORDS } = run_board_labels
const KIND = run_event_stream.EVENT_KIND
const ROOT = 7521
const LANE = 7530
const LATER_LANE = 7531
const LANE_LIMIT = 6
const RUN_MS = 1_500_000
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

	// The legend, the frame's last two lines, also names the root run's phase.
	it('keeps the backlogrun header and lane rows', async () => {
		const lines = await frame_of(ROOTED)
		const plain = await frame_of(CARRIED)

		expect(lines[0]).toBe(plain[0])
		expect(lines[0]).toContain('backlogrun')
		expect(lines.slice(index_of(lines, `${LANES_ICON} lanes`), -2)).toStrictEqual(
			plain.slice(index_of(plain, `${LANES_ICON} lanes`), -2),
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
})

describe('run_board_tick.tick — the root single run’s legend and absence', () => {
	it('names the root run’s phase in the legend', async () => {
		const lines = await frame_of(ROOTED)

		expect(lines.at(-2)).toContain(`${PHASE_ICONS.implement} ${WORDS.implement}`)
	})

	it('draws no 🏠 rule without a root run', async () => {
		const lines = await frame_of(CARRIED)

		expect(lines.some((line) => line.includes('🏠'))).toBe(false)
	})
})

// joshuafolkken/kit#7525: a root single run a merge ended leaves 🏠 and joins ✅ done as a lane does.
const ENDED: LocalRead = {
	...CARRIED,
	ended_roots: [{ command: 'fullrun', issue: ROOT, started_ms: START, ended_ms: START + RUN_MS }],
}

describe('run_board_tick.tick — a root single run that merged', () => {
	it('lists the run under ✅ done with its merged mark and time, and no 🏠 rule', async () => {
		const lines = await frame_of(ENDED)
		const done = index_of(lines, `${STATE_ICONS.merged} done`)
		const row = lines[done + 1] ?? ''

		expect(done).toBeGreaterThan(-1)
		expect(row).toContain(`${STATE_ICONS.merged} `)
		expect(row).toContain(String(ROOT))
		expect(row).toContain('25′00″')
		expect(lines.some((line) => line.includes('🏠'))).toBe(false)
	})

	it('draws no arrival in the header for it once the plan’s total is taken', async () => {
		const { ports, frames, read_local, clock } = harness(CARRIED, [plan_titled('a')])
		const first = await tick(FRESH_STATE, ports)

		read_local.mockResolvedValue(ENDED)
		clock.now_ms += run_board_gather.LOCAL_READ_MS
		await tick(first, ports)
		const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

		expect(first.baseline_total).toBeDefined()
		expect(lines.some((line) => line.includes(String(ROOT)))).toBe(true)
		expect(header(lines).join('\n')).not.toMatch(/\(\+\d+\)/u)
	})

	it('still draws a lane that arrives after it as an arrival', async () => {
		const { ports, frames, read_local, clock } = harness(ENDED, [plan_titled('a')])
		const first = await tick(FRESH_STATE, ports)
		const arrival = event(KIND.CHILD_LAUNCH, `#${String(LATER_LANE)} fullrun`)

		read_local.mockResolvedValue({ ...ENDED, events: [...ENDED.events, arrival] })
		clock.now_ms += run_board_gather.LOCAL_READ_MS
		await tick(first, ports)
		const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

		expect(header(lines).join('\n')).toContain('(+1)')
	})
})
