import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { josh_command } from '#scripts/josh/josh-run'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type DriveState, type OfferRead } from './backlog-drive'
import type { DriveContext } from './backlog-drive-args'
import { backlog_drive_cli } from './backlog-drive-cli'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
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

const STARTED_AT = '2026-11-08T00:00:00.000Z'
const STATE = backlog_drive.initial_state([], STARTED_AT)
const OFFER_ARGV = ['backlog:offer']
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

function stub_offer_path(
	named: OfferRead | undefined,
	pool: DriveState = STATE,
): ReturnType<typeof vi.spyOn> {
	vi.spyOn(backlog_drive_owner, 'assert_current').mockResolvedValue(CARRY)
	vi.spyOn(backlog_drive_named_offer, 'read').mockResolvedValue({ offer: named, pool })
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)

	return vi.spyOn(backlog_drive_rate, 'offer_run').mockResolvedValue({ code: 1, out: '', err: '' })
}

describe('backlog_drive_cli.read_offer', () => {
	it('reads the backlog:offer listing through the rate-limit measurement', async () => {
		const offer_run = stub_offer_path(undefined)

		await expect(backlog_drive_cli.read_offer(STATE, CONTEXT)).resolves.toBeUndefined()
		expect(offer_run).toHaveBeenCalledTimes(1)
	})

	it('leaves a named offer, which reads no listing, unmeasured', async () => {
		const named: OfferRead = { verdict: 'watch', issues: [], retries: 0 }
		const offer_run = stub_offer_path(named)

		await expect(backlog_drive_cli.read_offer(STATE, CONTEXT)).resolves.toBe(named)
		expect(offer_run).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#6883: a named issue the yield holds is no lane, so the pool must not relaunch it.
	it('excludes the named issues the yield holds from the pool offer', async () => {
		const offer_run = stub_offer_path(undefined, { ...STATE, exclude: ['9'] })

		await backlog_drive_cli.read_offer(STATE, CONTEXT)
		expect(offer_run).toHaveBeenCalledWith(expect.arrayContaining(['--exclude', '9']))
	})
})

describe('backlog_drive_rate.offer_run', () => {
	it('runs the offer command between the two rate reads and keeps its result', async () => {
		const result = { code: 0, out: 'run', err: '' }
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue(result)

		stub_reads(rate_json(1, RESET_SECONDS), rate_json(4, RESET_SECONDS))
		const emit = stub_emit()

		await expect(backlog_drive_rate.offer_run(OFFER_ARGV)).resolves.toBe(result)
		expect(run).toHaveBeenCalledWith(OFFER_ARGV, true)
		expect(emit).toHaveBeenCalledTimes(1)
	})
})

describe('backlog_drive_rate.offer_run lane:prune', () => {
	it('runs lane:prune with its stderr forwarded before the offer (ac-da10216f)', async () => {
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '', err: '' })

		stub_reads(rate_json(1, RESET_SECONDS), rate_json(1, RESET_SECONDS))
		stub_emit()

		await backlog_drive_rate.offer_run(OFFER_ARGV)
		expect(run.mock.calls).toEqual([
			[['lane:prune'], true],
			[OFFER_ARGV, true],
		])
	})

	it('counts the lane:prune spend in the measured cycle', async () => {
		const api = vi
			.spyOn(git_gh_exec, 'exec_gh_api_uncounted')
			.mockResolvedValue(rate_json(1, RESET_SECONDS))
		const run = vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '', err: '' })

		stub_emit()

		await backlog_drive_rate.offer_run(OFFER_ARGV)
		const [first_read, last_read] = api.mock.invocationCallOrder
		const [prune_call] = run.mock.invocationCallOrder

		expect(prune_call).toBeGreaterThan(first_read ?? Infinity)
		expect(prune_call).toBeLessThan(last_read ?? -Infinity)
	})

	it('still reads the offer when lane:prune fails', async () => {
		const result = { code: 0, out: 'run', err: '' }

		vi.spyOn(josh_command, 'josh_run')
			.mockResolvedValueOnce({ code: 1, out: '', err: 'These lanes could not be closed' })
			.mockResolvedValueOnce(result)

		stub_reads(rate_json(1, RESET_SECONDS), rate_json(1, RESET_SECONDS))
		stub_emit()

		await expect(backlog_drive_rate.offer_run(OFFER_ARGV)).resolves.toBe(result)
	})
})
