import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gh_request_tally, type CoreUsage } from './gh-request-tally'

// joshuafolkken/kit#6694: the process-wide counts of gh requests and 304 answers.
// joshuafolkken/kit#6697: the core `used` difference around the process's calls.

const RESET_MS = 1_793_000_000_000
const START: CoreUsage = { used: 679, reset_ms: RESET_MS }
const END: CoreUsage = { used: 712, reset_ms: RESET_MS }
const KIND = 'GET repos/{o}/{r}/issues/{n}'
const ZERO = { calls: 0, not_modified: 0, endpoints: {} }

function reader_of(
	...readings: Array<CoreUsage | undefined>
): ReturnType<typeof vi.fn<() => Promise<CoreUsage | undefined>>> {
	const read = vi.fn<() => Promise<CoreUsage | undefined>>()

	for (const reading of readings) read.mockResolvedValueOnce(reading)

	return read
}

beforeEach(() => {
	gh_request_tally.reset()
})

describe('gh_request_tally', () => {
	it('starts at zero', () => {
		expect(gh_request_tally.snapshot()).toStrictEqual(ZERO)
	})

	it('adds one per counted call and per counted 304, in the total and under its kind', () => {
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_call('graphql')
		gh_request_tally.count_not_modified(KIND)

		expect(gh_request_tally.snapshot()).toStrictEqual({
			calls: 3,
			not_modified: 1,
			endpoints: {
				[KIND]: { calls: 2, not_modified: 1 },
				graphql: { calls: 1, not_modified: 0 },
			},
		})
	})

	it('hands out a copy, so a held snapshot does not move with later counts', () => {
		const held = gh_request_tally.snapshot()

		gh_request_tally.count_call(KIND)

		expect(held.calls).toBe(0)
	})
})

// joshuafolkken/kit#6867: the same counts per call kind.
describe('gh_request_tally — per call kind', () => {
	it('hands out a copy of the per-kind counts too', () => {
		gh_request_tally.count_call(KIND)
		const held = gh_request_tally.snapshot()

		gh_request_tally.count_call(KIND)

		expect(held.endpoints[KIND]?.calls).toBe(1)
	})

	it('reset returns both counts and the kinds to zero', () => {
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_not_modified(KIND)
		gh_request_tally.reset()

		expect(gh_request_tally.snapshot()).toStrictEqual(ZERO)
	})
})

// joshuafolkken/kit#7013: a command's bundle chunk carries its own copy of this module, and its
// calls must reach the counts the dispatcher's copy records.
describe('gh_request_tally — one state per process', () => {
	it('counts a call made through another copy of the module into the same totals', async () => {
		vi.resetModules()
		const { gh_request_tally: copy } = await import('./gh-request-tally')

		copy.count_call(KIND)

		expect(copy).not.toBe(gh_request_tally)
		expect(gh_request_tally.snapshot()).toStrictEqual({
			calls: 1,
			not_modified: 0,
			endpoints: { [KIND]: { calls: 1, not_modified: 0 } },
		})
	})

	it('starts the allowance reading the other copy was given', async () => {
		const read = reader_of(START, END)

		gh_request_tally.watch_core(read)
		vi.resetModules()
		const { gh_request_tally: copy } = await import('./gh-request-tally')

		copy.count_call(KIND)

		expect(read).toHaveBeenCalledTimes(1)
	})
})

describe('gh_request_tally.core_delta', () => {
	it('reads once before the first counted call and answers the difference at the end', async () => {
		const read = reader_of(START, END)

		gh_request_tally.watch_core(read)
		gh_request_tally.count_call(KIND)
		gh_request_tally.count_call(KIND)

		expect(read).toHaveBeenCalledTimes(1)
		await expect(gh_request_tally.core_delta()).resolves.toBe(END.used - START.used)
		expect(read).toHaveBeenCalledTimes(2)
		expect(gh_request_tally.snapshot().calls).toBe(2)
	})

	it('reads nothing and answers none for a process that made no call', async () => {
		const read = reader_of(START, END)

		gh_request_tally.watch_core(read)

		await expect(gh_request_tally.core_delta()).resolves.toBeUndefined()
		expect(read).not.toHaveBeenCalled()
	})

	it('reads nothing for a process that never watched the allowance', async () => {
		gh_request_tally.count_call(KIND)

		await expect(gh_request_tally.core_delta()).resolves.toBeUndefined()
	})
})

describe('gh_request_tally.core_delta — readings that answer none', () => {
	it.each([
		['the start reading failed', undefined, END],
		['the end reading failed', START, undefined],
		['the window refilled between the readings', START, { used: 3, reset_ms: RESET_MS + 1 }],
	])('answers none without throwing when %s', async (_case, start, end) => {
		gh_request_tally.watch_core(reader_of(start, end))
		gh_request_tally.count_call(KIND)

		await expect(gh_request_tally.core_delta()).resolves.toBeUndefined()
	})

	it('answers none without throwing when the reader itself rejects', async () => {
		const read = vi.fn<() => Promise<CoreUsage | undefined>>().mockRejectedValue(new Error('spawn'))

		gh_request_tally.watch_core(read)
		gh_request_tally.count_call(KIND)

		await expect(gh_request_tally.core_delta()).resolves.toBeUndefined()
	})
})
