import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { split_resolution } from './split-resolution'

// joshuafolkken/kit#6212: only a filed split child answers the notice, never a reason comment.

const ISSUE = 4695
const OTHER_ISSUE = 4696
const AT = '2026-10-23T00:00:00.000Z'
const APPEND_FAILED = 'append failed'
const FOLD_TARGET = '4701'

const NOTICE: LedgerEntry = {
	kind: lane_ledger.KIND.SPLIT_NOTICE,
	at: AT,
	issue: ISSUE,
	files: 11,
	lines: 550,
}
const SPLIT_CHILD: LedgerEntry = {
	kind: lane_ledger.KIND.SPLIT_FILED,
	at: AT,
	issue: ISSUE,
	child: '#4700',
}

const record_split_filed = vi.spyOn(lane_ledger_write, 'record_split_filed')
const error = vi.spyOn(console, 'error')

beforeEach(() => {
	record_split_filed.mockResolvedValue()
	error.mockImplementation(vi.fn())
	vi.stubEnv(lane_child_marker.KEY, String(OTHER_ISSUE))
})

describe('split_resolution.notices and split_issues', () => {
	it('reads the notices and the Issues whose lane filed a split child', () => {
		expect(split_resolution.notices([NOTICE, SPLIT_CHILD])).toStrictEqual([NOTICE])
		expect(split_resolution.split_issues([NOTICE, SPLIT_CHILD])).toStrictEqual(new Set([ISSUE]))
	})
})

// joshuafolkken/kit#7183: a dispatched lane is never split, so its own split filing is refused.
describe('split_resolution.is_split_clear', () => {
	it('refuses a split filed from the dispatched lane it would split', () => {
		const filing = { route: SPLIT_ROUTE_LABEL, found_during: String(OTHER_ISSUE) }

		expect(split_resolution.is_split_clear(filing)).toBe(false)
		expect(String(error.mock.calls.at(-1)?.[0])).toContain('never split')
	})

	it('refuses a split that omits --found-during in the dispatched lane', () => {
		expect(
			split_resolution.is_split_clear({ route: SPLIT_ROUTE_LABEL, found_during: undefined }),
		).toBe(false)
		expect(String(error.mock.calls.at(-1)?.[0])).toContain(`#${String(OTHER_ISSUE)}`)
	})

	it('passes another route and another lane', () => {
		const filings = [
			{ route: 'route:bug', found_during: String(OTHER_ISSUE) },
			{ route: SPLIT_ROUTE_LABEL, found_during: String(ISSUE) },
		]

		expect(filings.every((filing) => split_resolution.is_split_clear(filing))).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})

	it('passes a split filed outside any dispatched lane', () => {
		vi.stubEnv(lane_child_marker.KEY, '')

		expect(
			split_resolution.is_split_clear({ route: SPLIT_ROUTE_LABEL, found_during: undefined }),
		).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})
})

describe('split_resolution.record_child', () => {
	it('reports the existing child URL and a recovery command when recording fails', async () => {
		const child = 'https://github.com/joshuafolkken/kit/issues/4700'

		record_split_filed.mockRejectedValueOnce(new Error(APPEND_FAILED))

		await expect(
			split_resolution.record_child({
				route: SPLIT_ROUTE_LABEL,
				found_during: String(ISSUE),
				child,
			}),
		).rejects.toThrow(`pnpm josh split:recover ${String(ISSUE)} ${child}`)
	})

	it('records a split child against the lane it was found in', async () => {
		const filing = { route: SPLIT_ROUTE_LABEL, found_during: String(ISSUE), child: '#4700' }

		await split_resolution.record_child(filing)

		expect(record_split_filed).toHaveBeenCalledExactlyOnceWith({ issue: ISSUE, child: '#4700' })
	})

	it('records nothing for another route or a filing found in no lane', async () => {
		await split_resolution.record_child({ route: 'route:bug', found_during: '1', child: '#1' })
		await split_resolution.record_child({
			route: SPLIT_ROUTE_LABEL,
			found_during: undefined,
			child: '#1',
		})

		expect(record_split_filed).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6630: a split part folded into an existing Issue answers the notice.
describe('split_resolution.record_fold', () => {
	const fold = { origin: String(ISSUE), target: FOLD_TARGET }

	it('records the fold target as the origin lane split child', async () => {
		await split_resolution.record_fold(fold)

		expect(record_split_filed).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			child: `#${FOLD_TARGET}`,
		})
	})

	it('lets the recorded fold answer the notice as a split child', async () => {
		await split_resolution.record_fold(fold)
		const recorded = record_split_filed.mock.calls[0]?.[0] ?? { issue: OTHER_ISSUE, child: '' }
		const entry: LedgerEntry = { kind: lane_ledger.KIND.SPLIT_FILED, at: AT, ...recorded }

		expect(split_resolution.split_issues([NOTICE, entry]).has(ISSUE)).toBe(true)
	})

	it('names the folded issue and the cause when recording fails', async () => {
		record_split_filed.mockRejectedValueOnce(new Error(APPEND_FAILED))

		await expect(split_resolution.record_fold(fold)).rejects.toThrow(
			new RegExp(`Folded into .*${FOLD_TARGET}.*${APPEND_FAILED}`, 'u'),
		)
	})
})
