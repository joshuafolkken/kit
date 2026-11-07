import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import type { DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_drive_rate } from './backlog-drive-rate'

const RESET_SECONDS = 1_793_000_000
const NEXT_RESET_SECONDS = 1_793_003_600
const RESET_ISO = new Date(RESET_SECONDS * 1000).toISOString()
const OFFER = { verdict: 'run' }

function rate_json(used: number, reset: number): string {
	return JSON.stringify({ used, remaining: 5000 - used, limit: 5000, reset })
}

function stub_reads(...reads: ReadonlyArray<string | Error>): void {
	const api = vi.spyOn(git_gh_exec, 'exec_gh_api_uncounted')

	for (const read of reads) {
		if (read instanceof Error) api.mockRejectedValueOnce(read)
		else api.mockResolvedValueOnce(read)
	}
}

function stub_emit(): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_rate.measured', () => {
	it('writes one rate-limit event with the cycle used delta, remaining and reset (ac-5894ab56)', async () => {
		stub_reads(rate_json(100, RESET_SECONDS), rate_json(112, RESET_SECONDS))
		const emit = stub_emit()

		await expect(backlog_drive_rate.measured(async () => OFFER)).resolves.toBe(OFFER)
		expect(emit).toHaveBeenCalledTimes(1)
		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.RATE_LIMIT,
			JSON.stringify({ used_delta: 12, remaining: 4888, reset: RESET_ISO }),
		)
	})

	it('keeps the offer answer and writes the event as missing when a read fails (ac-898a9e89)', async () => {
		stub_reads(new Error('gh api rate_limit failed'), rate_json(112, RESET_SECONDS))
		const emit = stub_emit()

		await expect(backlog_drive_rate.measured(async () => OFFER)).resolves.toBe(OFFER)
		expect(emit).toHaveBeenCalledTimes(1)
		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.RATE_LIMIT,
			JSON.stringify({ is_missing: true }),
		)
	})
})

describe('backlog_drive_rate.measured reads', () => {
	it('writes the event as missing when the rate_limit answer is not the expected shape', async () => {
		stub_reads('{}', rate_json(112, RESET_SECONDS))
		const emit = stub_emit()

		await expect(backlog_drive_rate.measured(async () => OFFER)).resolves.toBe(OFFER)
		expect(emit).toHaveBeenCalledWith(
			run_event_stream.EVENT_KIND.RATE_LIMIT,
			JSON.stringify({ is_missing: true }),
		)
	})

	it('counts from the new window when the cycle crossed the hourly reset', async () => {
		stub_reads(rate_json(4990, RESET_SECONDS), rate_json(3, NEXT_RESET_SECONDS))
		const emit = stub_emit()

		await backlog_drive_rate.measured(async () => OFFER)
		const text = String(emit.mock.calls[0]?.[1])

		expect(JSON.parse(text)).toMatchObject({ used_delta: 3, remaining: 4997 })
	})
})

const CONTEXT: DriveContext = {
	owner: String(process.pid),
	active: undefined,
	forwarded: [],
	exclude: [],
	awaited: [],
	window_ms: undefined,
	window: undefined,
	is_only: false,
	stopped: undefined,
}

describe('backlog_drive_cli.offer_for', () => {
	it('reads every production offer through the rate-limit measurement', async () => {
		const read = { verdict: 'watch', issues: [], retries: 0 }
		const measured = vi.spyOn(backlog_drive_rate, 'measured').mockResolvedValue(read)

		vi.spyOn(backlog_drive_owner, 'assert_current').mockRejectedValue(new Error('unmeasured'))
		const state = backlog_drive.initial_state([], '2026-11-08T00:00:00.000Z')

		await expect(backlog_drive_cli.offer_for(state, CONTEXT)).resolves.toBe(read)
		expect(measured).toHaveBeenCalledTimes(1)
	})
})
