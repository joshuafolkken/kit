import { stripVTControlCharacters } from 'node:util'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_labels } from './run-board-labels'
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
const { PHASE_ICONS, STATE_ICONS } = run_board_labels
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

const HELD: LocalRead = {
	...LOCAL,
	lanes: [String(EARLIER)],
	earlier_lanes: [String(EARLIER)],
	earlier_occupied: [String(EARLIER)],
	earlier_statuses: new Map([[EARLIER, EARLIER_STATUS]]),
}

function usage_mark(paused: ReadonlyMap<string, number>): UsageMark {
	return {
		at_ms: 0,
		processes: new Map([[1, { cpu_ms: 0, memory_bytes: 100, compressed_bytes: 0 }]]),
		lanes: new Map([[1, String(EARLIER)]]),
		names: new Map([[1, 'node']]),
		parents: new Map(),
		folded: new Set(),
		paused,
		cores: 1,
		total_bytes: 1000,
	}
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
	return (
		lines.find((line) => new RegExp(String.raw`\s${String(issue)}(\s|$)`, 'u').test(line)) ?? ''
	)
}

function header(lines: ReadonlyArray<string>): Array<string> {
	return lines.slice(0, lines.indexOf(''))
}

describe('run_board_tick.tick — what an earlier run’s lane is doing', () => {
	it('draws its phase, its time from its launch and its newest activity', async () => {
		const phase = event_of(1, 'lane-phase', `#${String(EARLIER)} implement`)
		const row = row_of(await frame_of({ ...HELD, events: [phase] }), EARLIER)

		expect(row).toContain(STATE_ICONS.earlier)
		expect(row).toContain(`${String(LAUNCHED_MINUTES)}′00″`)
		expect(row).toContain(PHASE_ICONS.implement)
	})

	it('draws its newest activity as this run’s own row does', async () => {
		const stage = event_of(1, 'ship-stage', `#${String(EARLIER)} gate start`)
		const row = row_of(await frame_of({ ...HELD, events: [stage] }), EARLIER)

		expect(row).toMatch(new RegExp(`${PHASE_ICONS.gate} 0″$`, 'u'))
	})

	it('draws its lane paused as this run’s own is', async () => {
		const mark = usage_mark(new Map([[String(EARLIER), LOCAL.started_ms]]))
		const row = row_of(await frame_of(HELD, mark), EARLIER)

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

		expect(row_of(lines, EARLIER).trim().startsWith(STATE_ICONS.earlier)).toBe(true)
		expect(header(lines)[0]).toBe(header(quiet)[0])
	})

	it('keeps this run’s own child running across its cut and resume', async () => {
		const launch = {
			...event_of(1, 'child-launch', `#${String(OWN)} a`),
			at: new Date(LOCAL.started_ms).toISOString(),
		}
		const own = [launch, ...CUT_RESUME.map((event) => ({ ...event, text: `#${String(OWN)} x` }))]
		const lines = await frame_of({ ...HELD, lanes: [String(OWN), String(EARLIER)], events: own })

		expect(row_of(lines, OWN)).not.toContain(STATE_ICONS.earlier)
		expect(header(lines)[0]).toContain('🔄 1')
	})
})
