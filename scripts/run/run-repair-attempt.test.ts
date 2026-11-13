import { describe, expect, it } from 'vitest'
import type { RunEvent } from './event/run-event-stream'
import { run_repair_attempt } from './run-repair-attempt'

const ISSUE = '7477'
const REVIEW_AT = '2026-11-12T01:00:00Z'
const HUMAN_REVIEW = 'human-review'

function event(pos: number, kind: string, text = `#${ISSUE}`): RunEvent {
	return { pos, kind, text, at: REVIEW_AT }
}

describe('repair attempt history', () => {
	it('does not inherit a review stop across the existing retry boundary', () => {
		const retry = event(2, 'add', `retry #${ISSUE} repair`)
		const events = [event(1, HUMAN_REVIEW), retry, event(3, 'plan')]
		const attempt = run_repair_attempt.issue_attempt(events, ISSUE)

		expect(attempt).toStrictEqual([retry, events[2]])
		expect(run_repair_attempt.reviewed_at(attempt)).toBeUndefined()
	})

	it.each(['merge', 'withdraw', 'split'])('keeps a %s final after a review stop', (kind) => {
		expect(run_repair_attempt.reviewed_at([event(1, HUMAN_REVIEW), event(2, kind)])).toBeUndefined()
	})

	it('finds the review boundary through a failed stale handoff dispatch', () => {
		const events = [event(1, HUMAN_REVIEW), event(2, 'child-launch'), event(3, 'park')]

		expect(run_repair_attempt.reviewed_at(events)).toBe(REVIEW_AT)
	})
})
