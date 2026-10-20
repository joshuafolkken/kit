import { stripVTControlCharacters } from 'node:util'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_earlier } from './run-board-earlier'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
import { run_board_lane_state } from './run-board-lane-state'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { ItemStatus } from './run-board-status'
import { run_board_tick } from './run-board-tick'
import type { UsageMark } from './run-board-usage'

// joshuafolkken/kit#4260: an earlier run's lane row drew 🧳 and its issue alone — no phase, no time, no
// usage, no activity — and a cut or a resume its child wrote after this run began counted it as this
// run's own.

const { LOCAL, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { NO_LANES } = run_board_lane_state
const { PHASE_ICONS, STATE_ICONS } = run_board_labels
const { EARLIER_ICON } = run_board_earlier
const EARLIER = 4173
const OWN = 4195
const MINUTE_MS = 60_000
const LAUNCHED_MINUTES = 12
const LAUNCHED_MS = LOCAL.started_ms - LAUNCHED_MINUTES * MINUTE_MS
const LATER = '2026-10-08T09:05:00.000Z'

function event_of(pos: number, kind: string, text: string): RunEvent {
	return { pos, at: LATER, kind, text }
}

// What the whole stream says the earlier lane is doing: launched before this run began.
const EARLIER_STATUS: ItemStatus = { state: 'running', started_ms: LAUNCHED_MS }

// The earlier lane holding a place, doing what its record and the stream say (`status`).
function held(status: ItemStatus): LocalRead {
	return {
		...LOCAL,
		lanes: [String(EARLIER)],
		lane_states: { ...NO_LANES, earlier: new Map([[EARLIER, status]]) },
		earlier_occupied: [String(EARLIER)],
	}
}

const HELD = held(EARLIER_STATUS)

// Its child's process, still working — not stopped as a paused lane's are.
const LIVE_MARK: UsageMark = {
	at_ms: 0,
	processes: new Map([[1, { cpu_ms: 0, memory_bytes: 100, compressed_bytes: 0 }]]),
	lanes: new Map([[1, String(EARLIER)]]),
	names: new Map([[1, 'eslint_d']]),
	parents: new Map(),
	folded: new Set(),
	cores: 1,
	total_bytes: 1000,
}

// The board's last frame; no plan read unless `plans` answers one.
async function frame_of(
	local: LocalRead,
	mark?: UsageMark,
	plans: ReadonlyArray<BoardPlan> = [],
): Promise<Array<string>> {
	const { ports, frames, read_usage } = harness(local, [...plans])

	if (mark !== undefined) read_usage.mockResolvedValue(mark)
	await tick(FRESH_STATE, ports)

	return stripVTControlCharacters(frames.at(-1) ?? '').split('\n')
}

function row_of(lines: ReadonlyArray<string>, issue: number): string {
	return lines.find((line) => new RegExp(String.raw`\s${String(issue)}\s`, 'u').test(line)) ?? ''
}

function header(lines: ReadonlyArray<string>): Array<string> {
	return lines.slice(0, lines.indexOf(''))
}

describe('run_board_tick.tick — what an earlier run’s lane is doing', () => {
	it('draws it marked 🧳, with its phase and its time from its launch', async () => {
		const status: ItemStatus = { ...EARLIER_STATUS, track: ['implement'], phase_ms: LAUNCHED_MS }
		const row = row_of(await frame_of(held(status)), EARLIER)

		expect(row).toContain(`${EARLIER_ICON} ${String(EARLIER)}`)
		expect(row).toContain(`${String(LAUNCHED_MINUTES)}′00″`)
	})

	it('draws its newest activity as this run’s own row does', async () => {
		const stage = event_of(1, 'ship-stage', `#${String(EARLIER)} gate start`)
		const row = row_of(await frame_of({ ...HELD, events: [stage] }), EARLIER)

		expect(row).toMatch(new RegExp(`${PHASE_ICONS.gate} 0″$`, 'u'))
	})

	// joshuafolkken/kit#4269: paused is the record's, whatever processes the lane still has running.
	it('draws its lane paused as its record says, beside a process still working', async () => {
		const paused = held({ ...EARLIER_STATUS, state: 'paused', ended_ms: LOCAL.started_ms })
		const row = row_of(await frame_of(paused, LIVE_MARK), EARLIER)

		expect(row.trim().startsWith(STATE_ICONS.paused)).toBe(true)
	})
})

describe('run_board_tick.tick — an earlier run’s lane its child cut and resumed', () => {
	const CUT_RESUME = [
		event_of(1, 'cut', `#${String(EARLIER)} cut`),
		event_of(2, 'resume', `#${String(EARLIER)} resumed`),
	]

	it.each([
		['before', []],
		['after', [plan_titled('a')]],
	])('keeps it a 🧳 row, uncounted, %s the plan is read', async (_, plans) => {
		const lines = await frame_of({ ...HELD, events: CUT_RESUME }, undefined, plans)
		const quiet = await frame_of(HELD, undefined, plans)

		expect(row_of(lines, EARLIER)).toContain(`${EARLIER_ICON} ${String(EARLIER)}`)
		expect(header(lines)[0]).toBe(header(quiet)[0])
	})

	it('keeps this run’s own child running across its cut and resume', async () => {
		const launch = {
			...event_of(1, 'child-launch', `#${String(OWN)} a`),
			at: new Date(LOCAL.started_ms).toISOString(),
		}
		const own = [launch, ...CUT_RESUME.map((event) => ({ ...event, text: `#${String(OWN)} x` }))]
		const lines = await frame_of({ ...HELD, lanes: [String(OWN), String(EARLIER)], events: own })

		expect(row_of(lines, OWN)).not.toContain(EARLIER_ICON)
		expect(header(lines)[0]).toContain('🔄 1')
	})
})
