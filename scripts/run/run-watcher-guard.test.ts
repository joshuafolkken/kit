import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_progress_clock } from './run-progress-clock'
import { run_watcher_guard } from './run-watcher-guard'

// joshuafolkken/kit#2113. The guard detects "in-flight lanes, stale watcher" and refuses — the
// same contract `batch:guard` and `rule:guard` hold. Behavior is pinned here so a refactor that
// silently returns 'ok' in the stale case is caught before it reaches a run.

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { has_lanes_in_flight: vi.fn() },
}))

vi.mock('./run-headless', () => ({
	run_headless: { is_backlog_parent: vi.fn() },
}))

const { lane_registry } = await import('#scripts/lane/lane-registry')
const { run_headless } = await import('./run-headless')
const lanes_in_flight = vi.mocked(lane_registry.has_lanes_in_flight)
const backlog_parent = vi.mocked(run_headless.is_backlog_parent)

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-watcher-guard-'))
const LIFE_TARGET = path.join(TEMPORARY, 'life.json')
const THRESHOLD_MS = run_watcher_guard.STALE_THRESHOLD_MS

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

beforeEach(() => {
	backlog_parent.mockResolvedValue(true)
	lanes_in_flight.mockResolvedValue(false)
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
		lanes_in_flight.mockResolvedValue(false)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('ok')
	})
})

// joshuafolkken/kit#2965: the lane listing is machine-wide, so only the session driving the run that
// dispatched the lanes owes them a watcher.
describe('check — lanes in-flight for another run', () => {
	it('returns ok for a session that drives no run, even with the watcher stale', async () => {
		backlog_parent.mockResolvedValue(false)
		lanes_in_flight.mockResolvedValue(true)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('ok')
	})
})

describe('check — lanes in-flight, watcher fresh', () => {
	it('returns ok when the life record was pinged recently', async () => {
		lanes_in_flight.mockResolvedValue(true)
		run_progress_clock.ping_life(LIFE_TARGET)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('ok')
	})
})

describe('check — lanes in-flight, watcher stale', () => {
	it('returns stale when the life record is absent', async () => {
		lanes_in_flight.mockResolvedValue(true)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('returns stale when the life record has no pinged_at (old format)', async () => {
		lanes_in_flight.mockResolvedValue(true)
		writeFileSync(LIFE_TARGET, JSON.stringify({ alive: true }))

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('returns stale when pinged_at is older than the threshold', async () => {
		lanes_in_flight.mockResolvedValue(true)
		const stale_time = new Date(Date.now() - THRESHOLD_MS - 1000).toISOString()

		writeFileSync(LIFE_TARGET, JSON.stringify({ alive: true, pinged_at: stale_time }))

		const result = await run_watcher_guard.check(LIFE_TARGET)

		expect(result.kind).toBe('stale')
	})

	it('includes the guidance message in the stale result', async () => {
		lanes_in_flight.mockResolvedValue(true)

		const result = await run_watcher_guard.check(LIFE_TARGET)

		if (result.kind !== 'stale') throw new Error('expected stale')

		expect(result.note).toBe(run_watcher_guard.STALE_NOTE)
	})
})
