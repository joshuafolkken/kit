import { describe, expect, it } from 'vitest'
import { cost_audit_kind } from './cost-audit-kind'

const REVIEW_PROMPT = 'Run a /code-review of this checkout'

describe('cost_audit_kind.kind_of — the kind is read off the opening prompt', () => {
	it.each([
		[REVIEW_PROMPT, false, 'review'],
		[REVIEW_PROMPT, true, 'review'],
		['Investigate how the gate works', true, 'subagent'],
		['Resuming the lane child for issue #3923', false, 'resume'],
		['backlogrun | Driver handoff: Driver result: judge', false, 'wake'],
		['fullrun #3930', false, 'fullrun'],
		['backlogrun', false, 'backlogrun'],
		['Why is the CPU at 100%?', false, cost_audit_kind.CONVERSATION],
		['', false, cost_audit_kind.CONVERSATION],
	])('reads %j (delegated: %s) as %s', (prompt, is_delegated, kind) => {
		expect(cost_audit_kind.kind_of(prompt, is_delegated)).toBe(kind)
	})
})
