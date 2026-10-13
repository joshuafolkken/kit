import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_drive_unread } from './backlog-drive-unread'
import { backlog_offer } from './backlog-offer'

// joshuafolkken/kit#3739: one failed state read of a named issue was handed to a session as
// `issue-state`, a result no row of the loop's table answers, with nothing saying which issue or why.

const ISSUE = '3725'
const UNREACHABLE = { kind: 'unreadable', reason: 'unreachable', status: undefined } as const
const LAST_RETRY = backlog_offer.RETRY_LIMIT - 1
const error_spy = vi.spyOn(console, 'error')

beforeEach(() => {
	error_spy.mockImplementation(vi.fn())
})

afterEach(() => {
	error_spy.mockReset()
})

test('waits for the next pass on a failed read, with the failure counted', () => {
	const offer = backlog_drive_unread.offer(ISSUE, UNREACHABLE, 0)

	expect(offer).toEqual({ verdict: 'wait', issues: [], retries: 1 })
	expect(error_spy).toHaveBeenCalledWith(
		'The state of named issue #3725 could not be read (unreachable); reading it again.',
	)
})

test('hands the offer back once the consecutive failures reach the retry limit', () => {
	const read = { kind: 'unreadable', reason: 'rejected', status: 403 } as const
	const offer = backlog_drive_unread.offer(ISSUE, read, LAST_RETRY)

	expect(offer).toEqual({ verdict: backlog_drive_unread.HANDED_BACK, issues: [], retries: 0 })
	expect(error_spy).toHaveBeenCalledWith(
		'The state of named issue #3725 could not be read (rejected, status 403); the offer failed 3 times in a row.',
	)
})

test('hands back a number that does not resolve without reading it again', () => {
	const offer = backlog_drive_unread.offer(ISSUE, { kind: 'missing' }, 0)

	expect(offer).toEqual({ verdict: backlog_drive_unread.HANDED_BACK, issues: [], retries: 0 })
	expect(error_spy).toHaveBeenCalledWith(
		'The state of named issue #3725 could not be read (the number does not resolve); check the number and the repository.',
	)
})

test('names a failure that carries no reason as unknown', () => {
	backlog_drive_unread.offer(ISSUE, { kind: 'unreadable' }, 0)

	expect(error_spy).toHaveBeenCalledWith(expect.stringContaining('(unknown reason)'))
})
