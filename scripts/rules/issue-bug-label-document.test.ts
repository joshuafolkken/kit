import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { BREAKING_CHANGE_LABEL, BUG_LABEL, ENHANCEMENT_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'

const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
// joshuafolkken/kit#2808: `josh issue:file` lints the body and applies the classification labels it
// declares, so every filing procedure routes through that one command instead of `issue:lint` plus
// hand-added labels.
const ISSUE_FILE = 'pnpm josh issue:file'

const FILING_DOCS = [
	'.claude/skills/workflow-commands/kickoff.md',
	'.claude/skills/workflow-commands/fullrun-steps.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/prerequisite.md',
	'.claude/skills/workflow-commands/observation-filing.md',
	'prompts/collaboration-workflow/upstream-interrupt.md',
	'prompts/collaboration-workflow/wip-cap.md',
	'prompts/review.md',
]

describe('bug labels at issue filing', () => {
	it('names the declaration and label in the canonical issue template', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		expect(template).toContain('- 種別: 不具合')

		for (const label of [BUG_LABEL, ENHANCEMENT_LABEL, BREAKING_CHANGE_LABEL]) {
			expect(template).toContain(`\`${label}\``)
		}

		expect(template).toContain('- 目的: 機能追加')
		expect(template).toContain('- 目的: 機能改善')
		expect(template).toContain('- 互換性: 破壊的変更')

		expect(template).toContain(ISSUE_FILE)
	})

	it.each(FILING_DOCS)('%s routes the bug label through issue:file', (document_) => {
		expect(read_repo_file(document_)).toContain(ISSUE_FILE)
	})
})
