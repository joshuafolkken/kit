import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { BREAKING_CHANGE_LABEL, BUG_LABEL, ENHANCEMENT_LABEL } from '#scripts/issue/issue-labels'
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

	// joshuafolkken/kit#3615: the bug criterion is judged against the owner's intent, not the
	// documented design — without it, behavior matching code comments and tests was filed as non-bug.
	// The two examples are joshuafolkken/kit#3614 (auto-ok applied as designed, wider than intended)
	// and #3615 itself (a doc-only fix to a criterion that produced a wrong classification); the
	// template names them by content because its issue-citation budget is an exact ratchet.
	it('judges a bug against the owner intent even when the behavior matches the design', () => {
		const template = read_repo_file(ISSUE_TEMPLATE)

		expect(template).toContain(
			'持ち主の意図と違う動きは、コード・コメント・テストに書かれた設計どおりでも `- 種別: 不具合` とする。',
		)
		expect(template).toContain('コメントとテストに固定されたまま意図より広く働く自動付与')
		expect(template).toContain('文書だけでも意図と違う分類を生む基準')
	})

	it.each(FILING_DOCS)('%s routes the bug label through issue:file', (document_) => {
		expect(read_repo_file(document_)).toContain(ISSUE_FILE)
	})
})
