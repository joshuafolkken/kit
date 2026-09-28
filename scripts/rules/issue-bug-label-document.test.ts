import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { BUG_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'

const ISSUE_TEMPLATE = 'prompts/collaboration-workflow/issue-template.md'
const ISSUE_LINT = 'issue:lint'

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
		expect(template).toContain(`labels[]=${BUG_LABEL}`)
		expect(template).toContain(ISSUE_LINT)
	})

	it.each(FILING_DOCS)('%s routes the bug label through issue:lint', (document_) => {
		const content = read_repo_file(document_)

		expect(content).toContain(ISSUE_LINT)
		expect(content).toContain(ISSUE_TEMPLATE)
	})
})
