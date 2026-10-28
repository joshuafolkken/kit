import { git_command } from '#scripts/git/git-command'
import { review_attest } from '#scripts/review/review-attest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_watch, type WatchRecord } from './issue-watch'
import { issue_watch_gate } from './issue-watch-gate'

// joshuafolkken/kit#3773: the refusals `josh review:attest --check` and `josh followup` raise on a
// person's update. No record must never refuse; an unread update must name `josh issue:ack`; and an
// update taken in after the review brief must send the review back, because the fix it led to is a
// change the review never read.

const ROOT = '/checkout'
const ISSUE = '3773'
const PENDING = 'Body edited:\n+ a new criterion'
const BRIEFED_AT = '2026-10-14T01:00:00.000Z'
const BEFORE_BRIEF = '2026-10-14T00:00:00.000Z'
const AFTER_BRIEF = '2026-10-14T02:00:00.000Z'

function record(overrides: Partial<WatchRecord> = {}): WatchRecord {
	return {
		issue: ISSUE,
		body: '',
		last_comment_id: 0,
		acknowledged_at: BEFORE_BRIEF,
		checked_at: BEFORE_BRIEF,
		...overrides,
	}
}

function stub_poll(answer: WatchRecord | undefined): void {
	vi.spyOn(issue_watch, 'poll').mockResolvedValue(answer)
}

beforeEach(() => {
	vi.spyOn(git_command, 'repository_root').mockResolvedValue(ROOT)
	vi.spyOn(review_attest, 'read_pointer').mockReturnValue({ nonce: 'n', taken_at: BRIEFED_AT })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_watch_gate.unread_refusal', () => {
	it('answers undefined when no run recorded a baseline', async () => {
		stub_poll(undefined)

		await expect(issue_watch_gate.unread_refusal(ROOT)).resolves.toBeUndefined()
	})

	it('names the pending update and the ack command, polling on every call', async () => {
		stub_poll(record({ pending: PENDING }))

		const refusal = await issue_watch_gate.unread_refusal(ROOT)

		expect(refusal).toContain(PENDING)
		expect(refusal).toContain(`pnpm josh issue:ack ${ISSUE}`)
		expect(issue_watch.poll).toHaveBeenCalledWith({ interval_ms: 0 }, ROOT)
	})

	it('answers undefined when nothing is pending', async () => {
		stub_poll(record())

		await expect(issue_watch_gate.unread_refusal(ROOT)).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#4633: an untrusted body edit is a notice, which holds no merge.
	it('answers undefined for a withheld body edit', async () => {
		stub_poll(record({ notice: 'withheld' }))

		await expect(issue_watch_gate.unread_refusal(ROOT)).resolves.toBeUndefined()
	})
})

describe('issue_watch_gate.review_refusal', () => {
	it('answers undefined with no record', async () => {
		stub_poll(undefined)

		await expect(issue_watch_gate.review_refusal(ROOT)).resolves.toBeUndefined()
	})

	it('refuses an unread update with the unread message', async () => {
		stub_poll(record({ pending: PENDING }))

		await expect(issue_watch_gate.review_refusal(ROOT)).resolves.toContain('pnpm josh issue:ack')
	})

	it('refuses when the update was acknowledged after the review brief', async () => {
		stub_poll(record({ acknowledged_at: AFTER_BRIEF }))

		const refusal = await issue_watch_gate.review_refusal(ROOT)

		expect(refusal).toContain(`briefed at ${BRIEFED_AT}`)
		expect(refusal).toContain('pnpm josh review:brief')
	})

	it('answers undefined when acknowledged before the brief, or with no brief', async () => {
		stub_poll(record())

		await expect(issue_watch_gate.review_refusal(ROOT)).resolves.toBeUndefined()

		vi.mocked(review_attest.read_pointer).mockReturnValue(undefined)
		stub_poll(record({ acknowledged_at: AFTER_BRIEF }))

		await expect(issue_watch_gate.review_refusal(ROOT)).resolves.toBeUndefined()
	})

	it('reads the checkout root for the here variant', async () => {
		stub_poll(record({ acknowledged_at: AFTER_BRIEF }))

		await expect(issue_watch_gate.review_refusal_here()).resolves.toContain(BRIEFED_AT)
		expect(review_attest.read_pointer).toHaveBeenCalledWith(ROOT)
	})
})

describe('issue_watch_gate.assert_read_here', () => {
	it('throws the unread message on a pending update', async () => {
		stub_poll(record({ pending: PENDING }))

		await expect(issue_watch_gate.assert_read_here()).rejects.toThrow(PENDING)
	})

	it('resolves when nothing is pending', async () => {
		stub_poll(record())

		await expect(issue_watch_gate.assert_read_here()).resolves.toBeUndefined()
	})
})
