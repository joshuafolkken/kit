import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { firing_point } from '#scripts/rules/firing-point'
import { describe, expect, it } from 'vitest'
import { behavior_change_lint } from './behavior-change-lint'

// joshuafolkken/kit#2212: the behavior-change declaration, the two required headings and the set of
// hook-deliverable firing points are the documents' single source, and the code carries constants that
// must not drift from them. Three things can rot independently: the template can drop a heading or the
// declaration line, and rule-delivery.md can drop a tool the firing-point check still counts as
// deliverable.

const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
const RULE_DELIVERY = 'prompts/collaboration-workflow/rule-delivery.md'

describe('issue-template.md carries the behavior-change declaration and headings', () => {
	it('names the declaration line the target check reads', () => {
		expect(read_repo_file(ISSUE_TEMPLATE)).toContain(behavior_change_lint.DECLARATION_LINE)
	})

	it('carries every required behavior-change heading', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		for (const heading of behavior_change_lint.REQUIRED_HEADINGS) {
			expect(template).toContain(heading)
		}
	})

	it('names the after-merge re-measurement command', () => {
		expect(read_repo_file(ISSUE_TEMPLATE)).toContain('measure:rerun')
	})
})

describe('rule-delivery.md carries every hook-deliverable firing point', () => {
	it('names each deliverable tool the firing-point check accepts', () => {
		const delivery = read_repo_file(RULE_DELIVERY)

		for (const tool of firing_point.HOOK_DELIVERABLE_TOOLS) {
			expect(delivery).toContain(tool)
		}
	})
})
