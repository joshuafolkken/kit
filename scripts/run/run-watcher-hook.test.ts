import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_progress_clock } from './run-progress-clock'
import { run_watcher_guard } from './run-watcher-guard'
import { run_watcher_hook } from './run-watcher-hook'

// joshuafolkken/kit#2353. The adapter turns `run_watcher_guard`'s verdict into a deny reason and fires
// once per run, so a stale watcher refuses the first call but not the restart that fixes it. The
// detection's four cases are pinned in `run-watcher-guard.test.ts`; here the wiring is pinned — the
// switch, the lane-child exemption, and the once-per-run stamp.

vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { has_lanes_in_flight: vi.fn() },
}))

vi.mock('./run-headless', () => ({
	run_headless: { is_backlog_parent: vi.fn(), is_headless: vi.fn(() => false) },
}))

vi.mock('./run-progress-read', () => ({
	run_progress_read: { live_target: vi.fn() },
}))

const { lane_registry } = await import('#scripts/lane/lane-registry')
const { run_headless } = await import('./run-headless')
const { run_progress_read } = await import('./run-progress-read')
const lanes_in_flight = vi.mocked(lane_registry.has_lanes_in_flight)
const live_target = vi.mocked(run_progress_read.live_target)

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-watcher-hook-'))
const LIFE_TARGET = path.join(TEMPORARY, 'life.json')

const sequence = { value: 0 }

// A distinct transcript per test keys a distinct once-per-run stamp, so one case's refusal record does
// not stand down the next case's first call.
function fresh_payload(): string {
	sequence.value += 1

	return JSON.stringify({
		transcript_path: path.join(TEMPORARY, `t-${String(sequence.value)}.jsonl`),
	})
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
})

beforeEach(() => {
	vi.mocked(run_headless.is_backlog_parent).mockResolvedValue(true)
	lanes_in_flight.mockResolvedValue(true)
	live_target.mockResolvedValue(LIFE_TARGET)
	delete process.env['JOSH_WATCHER_GUARD']
	delete process.env['JOSH_LANE_CHILD']
})

afterEach(() => {
	vi.clearAllMocks()

	try {
		rmSync(LIFE_TARGET, { force: true })
	} catch {
		/* absent is fine */
	}
})

describe('watcher_hook_reason — lanes in-flight, watcher stale', () => {
	it('refuses with the guard note on the first stale call', async () => {
		const reason = await run_watcher_hook.watcher_hook_reason(fresh_payload())

		expect(reason).toBe(run_watcher_guard.STALE_NOTE)
	})

	it('does not refuse the same run twice, so the restart is not itself blocked', async () => {
		const payload = fresh_payload()

		await run_watcher_hook.watcher_hook_reason(payload)
		const second = await run_watcher_hook.watcher_hook_reason(payload)

		expect(second).toBeUndefined()
	})
})

describe('watcher_hook_reason — passes the call through', () => {
	it('returns undefined when the watcher is fresh', async () => {
		run_progress_clock.ping_life(LIFE_TARGET)

		const reason = await run_watcher_hook.watcher_hook_reason(fresh_payload())

		expect(reason).toBeUndefined()
	})

	it('returns undefined when no lane is in-flight', async () => {
		lanes_in_flight.mockResolvedValue(false)

		const reason = await run_watcher_hook.watcher_hook_reason(fresh_payload())

		expect(reason).toBeUndefined()
	})

	it('is off when its switch is disabled', async () => {
		process.env['JOSH_WATCHER_GUARD'] = 'off'

		const reason = await run_watcher_hook.watcher_hook_reason(fresh_payload())

		expect(reason).toBeUndefined()
	})

	it('exempts a dispatched lane child', async () => {
		process.env['JOSH_LANE_CHILD'] = '2113'

		const reason = await run_watcher_hook.watcher_hook_reason(fresh_payload())

		expect(reason).toBeUndefined()
	})

	it('returns undefined for a payload that is not JSON', async () => {
		const reason = await run_watcher_hook.watcher_hook_reason('not json')

		expect(reason).toBeUndefined()
	})
})
