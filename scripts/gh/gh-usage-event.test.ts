import path from 'node:path'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_request_tally, type CoreUsage } from './gh-request-tally'
import { gh_usage_event } from './gh-usage-event'

// joshuafolkken/kit#6695: one `gh-usage` event per josh process, written as it ends.

const RESET_MS = 1_793_000_000_000
const STARTED_MS = 1_792_999_000_000
const ENDED_MS = 1_792_999_004_500
const CONTEXT = { command: 'run:board', issue: 6695, started_ms: STARTED_MS }

const make_directory = temporary_directory()

type Appended = Omit<RunEvent, 'pos'>

function recorder(): { events: Array<Appended>; append: (event: Appended) => Promise<void> } {
	const events: Array<Appended> = []

	return {
		events,
		append: async (event) => {
			events.push(event)
		},
	}
}

function watch_readings(...readings: Array<CoreUsage | undefined>): void {
	const read = vi.fn<() => Promise<CoreUsage | undefined>>()

	for (const reading of readings) read.mockResolvedValueOnce(reading)
	gh_request_tally.watch_core(read)
}

function text_of(event: Appended | undefined): unknown {
	return JSON.parse(event?.text ?? '{}')
}

beforeEach(() => {
	gh_request_tally.reset()
	gh_usage_event.reset()
	vi.spyOn(Date, 'now').mockReturnValue(ENDED_MS)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gh_usage_event.write — the one event', () => {
	it('writes the calls, the 304 answers, the core difference and the run time', async () => {
		const { events, append } = recorder()

		watch_readings({ used: 100, reset_ms: RESET_MS }, { used: 103, reset_ms: RESET_MS })
		gh_request_tally.count_call()
		gh_request_tally.count_call()
		gh_request_tally.count_not_modified()
		await gh_usage_event.write(CONTEXT, append)

		expect(events).toHaveLength(1)
		expect(events[0]?.kind).toBe('gh-usage')
		expect(events[0]?.elapsed_ms).toBe(ENDED_MS - STARTED_MS)
		expect(text_of(events[0])).toStrictEqual({
			command: 'run:board',
			issue: 6695,
			calls: 2,
			not_modified: 1,
			core_used_delta: 3,
		})
	})

	it('writes nothing for a process that sent no gh call', async () => {
		const { events, append } = recorder()

		await gh_usage_event.write(CONTEXT, append)

		expect(events).toHaveLength(0)
	})

	it('writes once however many times the process reaches its end', async () => {
		const { events, append } = recorder()

		gh_request_tally.count_call()
		await gh_usage_event.write(CONTEXT, append)
		await gh_usage_event.write(CONTEXT, append)

		expect(events).toHaveLength(1)
	})
})

describe('gh_usage_event.write — the run stream', () => {
	it('appends the event to the stream of the run this checkout belongs to', async () => {
		const target = path.join(make_directory('josh-gh-usage-event-'), 'events.jsonl')

		vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(target)
		gh_request_tally.count_call()
		await gh_usage_event.write(CONTEXT)

		expect(run_event_stream.read_events(target).map((event) => event.kind)).toStrictEqual([
			'gh-usage',
		])
	})

	it('resolves with no stream outside a git repository', async () => {
		vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(undefined)
		gh_request_tally.count_call()

		await expect(gh_usage_event.write(CONTEXT)).resolves.toBeUndefined()
	})
})

describe('gh_usage_event.write — a failure never fails the command', () => {
	it('leaves the core difference out when the rate_limit read fails', async () => {
		const { events, append } = recorder()

		const command = 'issue:file'

		gh_request_tally.watch_core(vi.fn().mockRejectedValue(new Error('rate_limit down')))
		gh_request_tally.count_call()
		await gh_usage_event.write({ command, started_ms: STARTED_MS }, append)

		expect(text_of(events[0])).toStrictEqual({ command, calls: 1, not_modified: 0 })
	})

	it('resolves when the append throws', async () => {
		const append = vi.fn().mockRejectedValue(new Error('lock held'))

		gh_request_tally.count_call()

		await expect(gh_usage_event.write(CONTEXT, append)).resolves.toBeUndefined()
	})
})
