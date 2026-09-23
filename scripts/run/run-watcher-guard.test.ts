import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CarryRead } from './run-carry'
import { run_progress_clock } from './run-progress-clock'
import { run_watcher_guard } from './run-watcher-guard'

// joshuafolkken/kit#2113. The guard detects "in-flight lanes, stale watcher" and refuses — the
// same contract `batch:guard` and `rule:guard` hold. Behavior is pinned here so a refactor that
// silently returns 'ok' in the stale case is caught before it reaches a run.

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { list_lanes: vi.fn() },
}))

const { lane_registry } = await import('#scripts/lane/lane-registry')
const list_lanes = vi.mocked(lane_registry.list_lanes)

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-watcher-guard-'))
const LIFE_TARGET = path.join(TEMPORARY, 'life.json')
const THRESHOLD_MS = run_watcher_guard.STALE_THRESHOLD_MS

const MOCK_LANE: LaneInfo = {
	issue: '2113',
	branch: '2113-lane',
	directory: '',
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

beforeEach(() => {
	list_lanes.mockResolvedValue([])
})

afterEach(() => {
	vi.clearAllMocks()

	try {
		rmSync(LIFE_TARGET, { force: true })
	} catch {
		/* absent is fine */
	}
})

describe('check — no lanes in-flight', () => {
	it('returns ok when no lanes are registered', async () => {
		list_lanes.mockResolvedValue([])

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('ok')
	})
})

describe('check — lanes in-flight, watcher fresh', () => {
	it('returns ok when the life record was pinged recently', async () => {
		list_lanes.mockResolvedValue([MOCK_LANE])
		run_progress_clock.ping_life(LIFE_TARGET)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('ok')
	})
})

describe('check — lanes in-flight, watcher stale', () => {
	it('returns stale when the life record is absent', async () => {
		list_lanes.mockResolvedValue([MOCK_LANE])

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('returns stale when the life record has no pinged_at (old format)', async () => {
		list_lanes.mockResolvedValue([MOCK_LANE])
		writeFileSync(LIFE_TARGET, JSON.stringify({ alive: true }))

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('returns stale when pinged_at is older than the threshold', async () => {
		list_lanes.mockResolvedValue([MOCK_LANE])
		const stale_time = new Date(Date.now() - THRESHOLD_MS - 1000).toISOString()

		writeFileSync(LIFE_TARGET, JSON.stringify({ alive: true, pinged_at: stale_time }))

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('includes the guidance message in the stale result', async () => {
		list_lanes.mockResolvedValue([MOCK_LANE])

		const result = await run_watcher_guard.check(LIFE_TARGET)

		if (result.kind !== 'stale') throw new Error('expected stale')

		expect(result.note).toBe(run_watcher_guard.STALE_NOTE)
	})
})

function carry_read(cuts: number): CarryRead {
	const carry = { invocation: 'backlogrun', started_at: new Date().toISOString(), cuts }

	return { kind: 'carried', carry: { ...carry, merged: 0, filed: 0, failures: 0, outages: 0 } }
}

// joshuafolkken/kit#2437. After a cut the attached session relays the run's stream; a relay it stopped
// restarting goes stale and is refused, while a run that never cut asks for no relay at all.
describe('check_relay — the relay after a cut', () => {
	const RELAY_TARGET = path.join(TEMPORARY, 'relay.json')

	afterEach(() => {
		rmSync(RELAY_TARGET, { force: true })
	})

	it('asks for no relay before the run has cut', () => {
		expect(run_watcher_guard.check_relay(RELAY_TARGET, carry_read(0)).kind).toBe('ok')
	})

	it('refuses a cut run whose relay never pinged', () => {
		const result = run_watcher_guard.check_relay(RELAY_TARGET, carry_read(1))

		expect(result).toStrictEqual({ kind: 'stale', note: run_watcher_guard.RELAY_STALE_NOTE })
	})

	it('passes a cut run whose relay pinged recently', () => {
		run_progress_clock.ping_life(RELAY_TARGET)

		expect(run_watcher_guard.check_relay(RELAY_TARGET, carry_read(1)).kind).toBe('ok')
	})

	it('refuses a relay last pinged beyond one follow interval and its slack', () => {
		const old = new Date(
			Date.now() - run_watcher_guard.RELAY_STALE_THRESHOLD_MS - 1000,
		).toISOString()

		writeFileSync(RELAY_TARGET, JSON.stringify({ alive: true, pinged_at: old }))

		expect(run_watcher_guard.check_relay(RELAY_TARGET, carry_read(1)).kind).toBe('stale')
	})
})
