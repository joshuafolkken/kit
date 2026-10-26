import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3643: a `backlogrun` samples its own machine load — one sample when the drive
// starts, one a minute while it runs, none once it stopped — and a sample that cannot be read never
// raises into the drive.

const sample_mock = vi.hoisted(() => vi.fn())

vi.mock('./lane-load', () => ({ lane_load: { sample: sample_mock } }))

const { lane_ledger } = await import('./lane-ledger')
const { lane_sampler } = await import('./lane-sampler')
const { run_event_stream } = await import('#scripts/run/event/run-event-stream')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-sampler-test-'))
const TICKS = 3
// joshuafolkken/kit#5032: a closed lid's half hour, past the tick that was due.
const SLEEP_MS = 30 * 60_000

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

function fresh_ledger(): string {
	return path.join(scratch, `${randomUUID()}.jsonl`)
}

beforeEach(() => {
	vi.useFakeTimers()
	sample_mock.mockReset().mockImplementation((at: string) => ({ kind: 'load', at, load: 3 }))
})

afterEach(() => {
	vi.useRealTimers()
})

describe('lane_sampler.start', () => {
	it('samples at once and then once a minute', async () => {
		const ledger_path = fresh_ledger()
		const stop = lane_sampler.start({ ledger_path })

		await vi.advanceTimersByTimeAsync(lane_sampler.SAMPLE_INTERVAL_MS * TICKS)
		stop()

		expect(lane_ledger.read_entries(ledger_path)).toHaveLength(TICKS + 1)
	})

	it('records nothing more once it is stopped', async () => {
		const ledger_path = fresh_ledger()
		const stop = lane_sampler.start({ ledger_path })

		await vi.advanceTimersByTimeAsync(0)
		stop()
		await vi.advanceTimersByTimeAsync(lane_sampler.SAMPLE_INTERVAL_MS * TICKS)

		expect(lane_ledger.read_entries(ledger_path)).toHaveLength(1)
	})

	it('drops a sample that could not be read instead of raising it', async () => {
		const ledger_path = fresh_ledger()

		sample_mock.mockRejectedValueOnce(new Error('sysctl did not answer'))
		const stop = lane_sampler.start({ ledger_path })

		await vi.advanceTimersByTimeAsync(lane_sampler.SAMPLE_INTERVAL_MS)
		stop()

		expect(lane_ledger.read_entries(ledger_path)).toHaveLength(1)
	})
})

describe('lane_sampler.start — host sleep', () => {
	it('records a tick the host slept through as a sleep on the run stream', async () => {
		const events_path = fresh_ledger()
		const stop = lane_sampler.start({ ledger_path: fresh_ledger(), events_path })

		vi.setSystemTime(Date.now() + SLEEP_MS)
		await vi.advanceTimersByTimeAsync(lane_sampler.SAMPLE_INTERVAL_MS)
		const woke_at = new Date().toISOString()

		stop()

		const [sleep] = run_event_stream.read_events(events_path)

		expect(sleep?.kind).toBe('sleep')
		expect(sleep?.at).toBe(woke_at)
		expect(sleep?.elapsed_ms).toBe(SLEEP_MS)
	})

	it('records no sleep while every tick is on time', async () => {
		const events_path = fresh_ledger()
		const stop = lane_sampler.start({ ledger_path: fresh_ledger(), events_path })

		await vi.advanceTimersByTimeAsync(lane_sampler.SAMPLE_INTERVAL_MS * TICKS)
		stop()

		expect(run_event_stream.read_events(events_path)).toStrictEqual([])
	})
})
