import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rule_list } from './rule-list'
import { stop_rules } from './stop-rules'

// The three stop-time rules are delivered on the Stop hook, and — like every delivered rule — their
// procedure lives in a single source the delivered text points at, not restated in the reason
// (joshuafolkken/kit#2121). This pins that `pnpm josh rule:list` (joshuafolkken/kit#3399) carries the
// rows and that each reason names its own single source, so a session the hook never reaches still
// has the rule.
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
		const text = rule_list.render()

		expect(text).toContain('Stop notification')
		expect(text).toContain('Hold release')
		expect(text).toContain('Offer to file')
	})

	// joshuafolkken/kit#4626: the reply's Issue references are no longer the stop guard's to correct.
	it('lists no Issue citation row for the stop guard', () => {
		expect(rule_list.render()).not.toContain('`issue-citation`')
	})
})

describe('stop_rules — each delivered text names its single source', () => {
	it('the stop notification reason points at rule-delivery.md', () => {
		expect(stop_rules.STOP_NOTIFY_REASON).toContain('`rule-delivery.md` → "stop-notify"')
	})

	it('the hold release reason points at working-tree-hold.md', () => {
		expect(stop_rules.HOLD_RELEASE_REASON).toContain('`working-tree-hold.md`')
	})

	it('the filing offer reason points at observation-filing.md', () => {
		expect(stop_rules.FILING_OFFER_REASON).toContain('`observation-filing.md`')
		expect(stop_rules.FILING_OFFER_REASON).toContain('observation-filing.md')
		expect(stop_rules.FILING_OFFER_REASON).toContain('pnpm josh issue:file')
	})

	it('the filing offer reason says it binds an unattended run', () => {
		expect(stop_rules.FILING_OFFER_REASON).toContain('this run is unattended')
	})
})
