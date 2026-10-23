import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_watch, type WatchRecord } from './issue-watch'
import { issue_watch_hook } from './issue-watch-hook'

// joshuafolkken/kit#3773: the PreToolUse adapter puts a person's update in front of the run once —
// a second refusal for the same text would wedge the run before it could act — and it fails open,
// because a hook that stalls every tool call over a network blip costs more than it watches for.

const ISSUE = '3773'
const PENDING = 'New comment by person at 2026-10-14\nplease also cover X'
const NEXT_PENDING = `${PENDING}\n\nNew comment by person at 2026-10-15\none more`
const NOTICE = 'The body was edited, but its author is not trusted.'
const NOW = new Date('2026-10-14T00:00:00.000Z')
const POLL_TIMEOUT_MS = 5000

// An in-memory record the stubbed poll answers and the stubbed `mark_shown` updates, so the
// once-per-update behavior is exercised across two hook calls.
function stub_record(initial: WatchRecord | undefined): { current: WatchRecord | undefined } {
	const state = { current: initial }

	vi.spyOn(issue_watch, 'poll').mockImplementation(async () => state.current)
	vi.spyOn(issue_watch, 'mark_shown').mockImplementation((shown: WatchRecord) => {
		state.current = { ...shown, shown: issue_watch.news_of(shown) }

		return state.current
	})

	return state
}

function record(pending: string | undefined): WatchRecord {
	return {
		issue: ISSUE,
		body: '',
		last_comment_id: 0,
		acknowledged_at: NOW.toISOString(),
		checked_at: NOW.toISOString(),
		pending,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_watch_hook.watch_reason', () => {
	it('shows a pending update once, not twice for the same text', async () => {
		stub_record(record(PENDING))

		const first = await issue_watch_hook.watch_reason(NOW)

		expect(first).toContain(PENDING)
		expect(first).toContain(`pnpm josh issue:ack ${ISSUE}`)
		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toBeUndefined()
	})

	it('shows a further update whose text differs', async () => {
		const state = stub_record(record(PENDING))

		await issue_watch_hook.watch_reason(NOW)

		state.current = { ...record(NEXT_PENDING), shown: PENDING }

		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toContain('one more')
	})

	it('polls at most once per interval with a short timeout', async () => {
		stub_record(undefined)

		await issue_watch_hook.watch_reason(NOW)

		expect(issue_watch.poll).toHaveBeenCalledWith({
			interval_ms: issue_watch_hook.POLL_INTERVAL_MS,
			timeout_ms: POLL_TIMEOUT_MS,
			now: NOW,
		})
	})

	it('answers undefined with no record or nothing pending', async () => {
		const state = stub_record(undefined)

		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toBeUndefined()

		state.current = record(undefined)

		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toBeUndefined()
		expect(issue_watch.mark_shown).not.toHaveBeenCalled()
	})

	it('fails open when the poll throws', async () => {
		vi.spyOn(issue_watch, 'poll').mockRejectedValue(new Error('network down'))

		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#4633: an untrusted body edit is shown once as a notice that asks for no ack.
describe('issue_watch_hook.watch_reason — a withheld body edit', () => {
	it('shows the notice once, without asking for an ack', async () => {
		stub_record({ ...record(undefined), notice: NOTICE })

		const first = await issue_watch_hook.watch_reason(NOW)

		expect(first).toBe(NOTICE)
		expect(first).not.toContain('issue:ack')
		await expect(issue_watch_hook.watch_reason(NOW)).resolves.toBeUndefined()
	})
})
