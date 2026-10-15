import { AUTO_OK_LABEL, DEFERRED_LABEL } from '#scripts/issue/issue-labels'
import type { WatchComment } from '#scripts/issue/issue-watch-diff'
import { describe, expect, it } from 'vitest'
import { auto_ok_judge } from './auto-ok-judge'

const ISSUE_NUMBER = 42
const BODY = 'Fix the thing.\n\nMore detail.'
const JUDGEMENT_ID = 10
const EARLIER_ID = 5
const LATER_ID = 20
const DECLINED = { is_applied: false, reason: 'a policy decision is needed' }

function comment(id: number, body: string, is_automated = false): WatchComment {
	return { id, author: 'someone', is_automated, created_at: '2026-10-15T00:00:00Z', body }
}

function judgement_of(body: string, id = JUDGEMENT_ID): WatchComment {
	return comment(id, auto_ok_judge.comment_of(DECLINED, body), true)
}

describe('auto_ok_judge.is_candidate', () => {
	it('takes an issue with no auto-ok and no excluded label', () => {
		expect(auto_ok_judge.is_candidate({ number: ISSUE_NUMBER, labels: ['bug'], body: BODY })).toBe(
			true,
		)
	})

	it('skips an issue already opted in', () => {
		expect(
			auto_ok_judge.is_candidate({ number: ISSUE_NUMBER, labels: [AUTO_OK_LABEL], body: BODY }),
		).toBe(false)
	})

	it('skips an issue carrying a label the filing exclusions refuse', () => {
		expect(
			auto_ok_judge.is_candidate({ number: ISSUE_NUMBER, labels: [DEFERRED_LABEL], body: BODY }),
		).toBe(false)
	})
})

describe('auto_ok_judge.is_judged', () => {
	it('owes a judgement when no judgement comment exists', () => {
		expect(auto_ok_judge.is_judged(BODY, [comment(EARLIER_ID, 'a remark')])).toBe(false)
	})

	it('is judged when the judgement covers the body as it stands', () => {
		expect(auto_ok_judge.is_judged(BODY, [judgement_of(BODY)])).toBe(true)
	})

	it('reads a CRLF body as the same body it judged under LF', () => {
		expect(auto_ok_judge.is_judged(BODY.replaceAll('\n', '\r\n'), [judgement_of(BODY)])).toBe(true)
	})

	it('is judged again once the body changed', () => {
		expect(auto_ok_judge.is_judged(`${BODY} Edited.`, [judgement_of(BODY)])).toBe(false)
	})

	it('is judged again once a person commented after the judgement', () => {
		const comments = [judgement_of(BODY), comment(LATER_ID, 'please reconsider')]

		expect(auto_ok_judge.is_judged(BODY, comments)).toBe(false)
	})

	it('stays judged when only an automated comment came after it', () => {
		const comments = [judgement_of(BODY), comment(LATER_ID, 'run status', true)]

		expect(auto_ok_judge.is_judged(BODY, comments)).toBe(true)
	})

	it('reads the newest judgement, not an older one for a previous body', () => {
		const comments = [judgement_of('old body', EARLIER_ID), judgement_of(BODY)]

		expect(auto_ok_judge.is_judged(BODY, comments)).toBe(true)
	})
})

describe('auto_ok_judge.comment_of', () => {
	it('carries the decision line and the body digest marker', () => {
		const text = auto_ok_judge.comment_of(DECLINED, BODY)

		expect(text).toContain(DECLINED.reason)
		expect(text).toMatch(/<!-- josh:auto-ok-judged body=[\da-f]+ -->$/u)
	})
})
