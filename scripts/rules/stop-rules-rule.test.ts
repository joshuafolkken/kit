import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { stop_rules } from './stop-rules'

// The three stop-time rules are delivered on the Stop hook, and — like every delivered rule — their
// procedure lives in a single source the delivered text points at, not restated in the reason
// (joshuafolkken/kit#2121). This pins that rule-delivery.md carries the three rows and that each
// reason names its own single source, so a session the hook never reaches still has the rule.
const RULE_DELIVERY_PATH = fileURLToPath(
	new URL('../../prompts/collaboration-workflow/rule-delivery.md', import.meta.url),
)

function rule_delivery_text(): string {
	return readFileSync(RULE_DELIVERY_PATH, 'utf8')
}

describe('rule-delivery.md — the Stop hook is a second entry on the one foundation', () => {
	it('documents the stop guard entry point', () => {
		const text = rule_delivery_text()

		expect(text).toContain('Stop フック')
		expect(text).toContain('stop:guard')
	})

	it('lists a row for each of the three stop-time rules', () => {
		const text = rule_delivery_text()

		expect(text).toContain('停止時の通知')
		expect(text).toContain('hold の解放')
		expect(text).toContain('Issue 引用')
	})
})

describe('stop_rules — each delivered text names its single source', () => {
	it('the stop notification reason points at the CLAUDE.md rule', () => {
		expect(stop_rules.STOP_NOTIFY_REASON).toContain('Mid-workflow stop notification')
		expect(stop_rules.STOP_NOTIFY_REASON).toContain('CLAUDE.md')
	})

	it('the hold release reason points at SKILL.md §2f', () => {
		expect(stop_rules.HOLD_RELEASE_REASON).toContain('§2f')
	})

	it('the issue citation reason points at issue-citation.md', () => {
		expect(stop_rules.ISSUE_CITATION_REASON).toContain('issue-citation.md')
	})
})
