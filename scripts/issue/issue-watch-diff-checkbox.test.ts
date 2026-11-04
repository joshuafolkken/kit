import { describe, expect, it } from 'vitest'
import { issue_watch_diff, type WatchSnapshot } from './issue-watch-diff'

const BODY = 'Requirements\n- [ ] Keep the wording\n  - [x] Nested task'
const CHECKED = 'Requirements\r\n- [x] Keep the wording\r\n  - [ ] Nested task'
const BODY_AT = '2026-11-04T00:00:00Z'
const ORIGINAL_WORDING = 'Keep the wording'
const CHANGED_WORDING = 'Changed requirement'
const baseline = { body: BODY, last_comment_id: 0 }

function snapshot(body: string, is_body_trusted: boolean | undefined): WatchSnapshot {
	return { body, is_body_trusted, comments: [] }
}

describe('issue_watch_diff — checkbox states', () => {
	it.each([true, false, undefined])('ignores task ticks with trust %s', (trust) => {
		const current = snapshot(CHECKED, trust)

		expect(issue_watch_diff.unread_diff(baseline, current)).toBeUndefined()
		expect(issue_watch_diff.withheld_notice(baseline, current)).toBeUndefined()
		expect(issue_watch_diff.landed_times(baseline, current, BODY_AT)).toStrictEqual([])
	})

	it('ignores uppercase checked states', () => {
		const current = snapshot(BODY.replace('[ ]', '[X]'), true)

		expect(issue_watch_diff.unread_diff(baseline, current)).toBeUndefined()
	})

	it('reports task wording changes while omitting unchanged tasks', () => {
		const current = snapshot(
			CHECKED.replace(ORIGINAL_WORDING, () => CHANGED_WORDING),
			true,
		)
		const diff = issue_watch_diff.unread_diff(baseline, current)

		expect(diff).toContain(ORIGINAL_WORDING)
		expect(diff).toContain(CHANGED_WORDING)
		expect(diff).not.toContain('Nested task')
	})

	it.each(['Requirements changed', 'Requirements [x]'])('reports other line edits: %s', (line) => {
		const current = snapshot(
			CHECKED.replace('Requirements', () => line),
			true,
		)

		expect(issue_watch_diff.unread_diff(baseline, current)).toContain(`+ ${line}`)
	})
})

describe('issue_watch_diff — checkbox syntax', () => {
	it('preserves inline checkbox changes as edits', () => {
		const previous = { body: 'Literal [ ] text', last_comment_id: 0 }
		const current = snapshot('Literal [x] text', true)

		expect(issue_watch_diff.unread_diff(previous, current)).toContain('+ Literal [x] text')
	})

	it.each(['*', '+', '1.', '2)', '\t-'])('ignores task ticks with marker %s', (marker) => {
		const previous = { body: `${marker} [ ] Task`, last_comment_id: 0 }
		const current = snapshot(`${marker} [x] Task`, true)

		expect(issue_watch_diff.unread_diff(previous, current)).toBeUndefined()
	})
})
