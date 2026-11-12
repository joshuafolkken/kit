import path from 'node:path'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_request_tally, type CoreUsage } from './gh-request-tally'
import { gh_usage_event, type GhUsageLine } from './gh-usage-event'
import { gh_usage_log } from './gh-usage-log'

// joshuafolkken/kit#6695: one gh usage line per josh process, written as it ends.

const RESET_MS = 1_793_000_000_000
const STARTED_MS = 1_792_999_000_000
const ENDED_MS = 1_792_999_004_500
const CONTEXT = { command: 'run:board', issue: 6695, started_ms: STARTED_MS }
const KIND = 'GET repos/{o}/{r}/issues/{n}'

const make_directory = temporary_directory()

const ENDED_AT = new Date(ENDED_MS).toISOString()
const ELAPSED_MS = ENDED_MS - STARTED_MS

function recorder(): { lines: Array<GhUsageLine>; append: (line: GhUsageLine) => Promise<void> } {
	const lines: Array<GhUsageLine> = []

	return {
		lines,
		append: async (line) => {
			lines.push(line)
		},
	}
}

function watch_readings(...readings: Array<CoreUsage | undefined>): void {
	const read = vi.fn<() => Promise<CoreUsage | undefined>>()

	for (const reading of readings) read.mockResolvedValueOnce(reading)
	gh_request_tally.watch_core(read)
}

beforeEach(() => {
	gh_request_tally.reset()
	gh_usage_event.reset()
	vi.spyOn(Date, 'now').mockReturnValue(ENDED_MS)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('gh_usage_event.write — the one line', () => {
	it('writes the calls, the 304 answers, the core difference and the run time', async () => {
		const { lines, append } = recorder()

		watch_readings({ used: 100, reset_ms: RESET_MS }, { used: 103, reset_ms: RESET_MS })
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_not_modified(KIND)
		await gh_usage_event.write(CONTEXT, append)

		expect(lines).toStrictEqual([
			{
				at: ENDED_AT,
				command: 'run:board',
				issue: 6695,
				calls: 2,
				not_modified: 1,
				core_used_delta: 3,
				elapsed_ms: ELAPSED_MS,
				endpoints: { [KIND]: { calls: 2, not_modified: 1 } },
			},
		])
	})

	it('writes nothing for a process that sent no gh call', async () => {
		const { lines, append } = recorder()

		await gh_usage_event.write(CONTEXT, append)

		expect(lines).toHaveLength(0)
	})

	it('writes once however many times the process reaches its end', async () => {
		const { lines, append } = recorder()

		gh_request_tally.count_call(KIND)
		await gh_usage_event.write(CONTEXT, append)
		await gh_usage_event.write(CONTEXT, append)

		expect(lines).toHaveLength(1)
	})
})

// joshuafolkken/kit#6707: the line goes to the usage log, where the run stream's bound cannot drop it.
describe('gh_usage_event.write — the usage log', () => {
	it("appends the line to the usage log of this checkout's repository", async () => {
		const target = path.join(make_directory('josh-gh-usage-event-'), 'usage.jsonl')

		const repository = '/repository'

		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(repository)
		vi.spyOn(gh_usage_log, 'target_of').mockReturnValue(target)
		gh_request_tally.count_call(KIND)
		await gh_usage_event.write(CONTEXT)

		const written = gh_usage_log.read_lines(target).map((line): unknown => JSON.parse(line))

		expect(gh_usage_log.target_of).toHaveBeenCalledWith(repository)
		expect(written).toMatchObject([{ command: 'run:board', calls: 1 }])
	})

	it('resolves with no log outside a git repository', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
		gh_request_tally.count_call(KIND)

		await expect(gh_usage_event.write(CONTEXT)).resolves.toBeUndefined()
	})
})

describe('gh_usage_event.write — a failure never fails the command', () => {
	it('leaves the core difference out when the rate_limit read fails', async () => {
		const { lines, append } = recorder()

		const command = 'issue:file'

		gh_request_tally.watch_core(vi.fn().mockRejectedValue(new Error('rate_limit down')))
		gh_request_tally.count_call(KIND)
		await gh_usage_event.write({ command, started_ms: STARTED_MS }, append)

		// `toEqual` passes over the absent issue and difference, which `JSON.stringify` leaves out.
		expect(lines[0]).toEqual({
			at: ENDED_AT,
			command,
			calls: 1,
			not_modified: 0,
			elapsed_ms: ELAPSED_MS,
			endpoints: { [KIND]: { calls: 1, not_modified: 0 } },
		})
	})

	it('resolves when the append throws', async () => {
		const append = vi.fn().mockRejectedValue(new Error('lock held'))

		gh_request_tally.count_call(KIND)

		await expect(gh_usage_event.write(CONTEXT, append)).resolves.toBeUndefined()
	})
})
