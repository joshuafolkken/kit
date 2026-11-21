import type { IssueComment } from '#scripts/issue/issue-read'
import { describe, expect, it } from 'vitest'
import { backlog_triage_adopted } from './backlog-triage-adopted'

const ADOPTION = { issue: '7780', option: 2, reason: 'keep the lane', done: '' }
const DECISION = '#7780: adopted park option 2 (backlog:triage --adopt) — keep the lane'

function comment_of(body: string, is_trusted = true): IssueComment {
	return { author: 'owner', body, created_at: '2026-11-17T13:56:58Z', is_trusted }
}

describe('backlog_triage_adopted', () => {
	it('writes the decision line unchanged, with the parent action when one was done', () => {
		expect(backlog_triage_adopted.text_of(ADOPTION)).toBe(DECISION)
		expect(backlog_triage_adopted.text_of({ ...ADOPTION, done: 'filed #1' })).toBe(
			`${DECISION} · parent action done: filed #1`,
		)
	})

	it('reads back the option it wrote', () => {
		const body = backlog_triage_adopted.text_of({ ...ADOPTION, option: 12 })

		expect(backlog_triage_adopted.option_of(comment_of(body))).toBe(12)
	})

	it.each([
		['a park note', '## Next step\n\nAdopt option 2 to continue.'],
		['a plain comment', 'adopted park option soon'],
		['a malformed option', '#1: adopted park option 0 (backlog:triage --adopt) — x'],
	])('reads no option from %s', (_name, body) => {
		expect(backlog_triage_adopted.option_of(comment_of(body))).toBeUndefined()
	})

	it('reads no option from an untrusted decision line', () => {
		expect(backlog_triage_adopted.option_of(comment_of(DECISION, false))).toBeUndefined()
	})
})
