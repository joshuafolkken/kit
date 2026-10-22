import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_next_shared } from './backlog-next-shared'

// joshuafolkken/kit#4550: the drive's assignment and the arrival probe each asked `backlog:next` every
// minute, and each read the whole pool from GitHub for the same answer.

const ARGV = ['backlog:next', '--exclude', '1630']
const RUN: JoshResult = { code: 0, out: '4550\n4551', err: 'explanation' }
const TARGET = '/stream/target'
const AT = '2026-10-22T00:00:00.000Z'
const MINUTE_MS = 60_000

function event(pos: number): RunEvent {
	return { pos, kind: 'launch', text: `launched ${String(pos)}`, at: AT }
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(TARGET)
	vi.spyOn(run_event_stream, 'read_last').mockReturnValue(event(1))
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue(RUN)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)

	return shared_cache_fixture.isolate_shared_cache(backlog_next_shared.NEXT_CACHE)
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('backlog_next_shared.read', () => {
	it('answers a second ask within the minute without running backlog:next again', async () => {
		expect(await backlog_next_shared.read(ARGV)).toEqual(RUN)
		expect(await backlog_next_shared.read(ARGV)).toEqual(RUN)
		expect(josh_command.josh_run).toHaveBeenCalledOnce()
	})

	it('replays the kept explanation when the reader forwards standard error', async () => {
		await backlog_next_shared.read(ARGV)
		await backlog_next_shared.read(ARGV, true)

		expect(console.error).toHaveBeenCalledExactlyOnceWith(RUN.err)
	})
})

describe('backlog_next_shared.read once its answer is stale', () => {
	it('reads again once a new event lands on the stream', async () => {
		await backlog_next_shared.read(ARGV)
		vi.mocked(run_event_stream.read_last).mockReturnValue(event(2))
		await backlog_next_shared.read(ARGV)

		expect(josh_command.josh_run).toHaveBeenCalledTimes(2)
	})

	it('reads again once the minute has passed', async () => {
		vi.useFakeTimers({ now: Date.parse(AT) })
		await backlog_next_shared.read(ARGV)
		vi.setSystemTime(Date.parse(AT) + MINUTE_MS)
		await backlog_next_shared.read(ARGV)

		expect(josh_command.josh_run).toHaveBeenCalledTimes(2)
	})
})

describe('backlog_next_shared.read on an answer it does not keep', () => {
	it.each([
		['a failure', { code: 1, out: '' }],
		['a retry', { code: 0, out: 'retry' }],
	])('keeps no answer for %s', async (_name, result: JoshResult) => {
		vi.mocked(josh_command.josh_run).mockResolvedValue(result)
		await backlog_next_shared.read(ARGV)
		await backlog_next_shared.read(ARGV)

		expect(josh_command.josh_run).toHaveBeenCalledTimes(2)
	})
})

describe('backlog_next_shared.read across a backlogrun', () => {
	// joshuafolkken/kit#4483: with a free slot the usual state, the drive's offer and the arrival probe
	// both asked within the same minute.
	it('runs backlog:next once for the drive and the arrival probe in one minute', async () => {
		const drive = await backlog_next_shared.read(ARGV, true)
		const probe = await backlog_next_shared.read(ARGV, false, MINUTE_MS)

		expect(probe).toEqual(drive)
		expect(josh_command.josh_run).toHaveBeenCalledOnce()
	})
})
