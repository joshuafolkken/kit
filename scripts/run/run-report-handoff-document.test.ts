import { read_document } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#4161: the hand-off report is printed by `run:report --handoff`, so the skill
// document is a pointer to the command and no longer carries a template a session fills in by hand.

const HANDOFF_REPORT_MD = '.claude/skills/workflow-commands/backlogrun-handoff-report.md'
const COMMAND = 'pnpm josh run:report --handoff'

describe('backlogrun-handoff-report.md', () => {
	it('points at the command that prints the report', () => {
		expect(read_document(HANDOFF_REPORT_MD)).toContain(COMMAND)
	})

	it('carries no template of the report', () => {
		const document = read_document(HANDOFF_REPORT_MD)

		expect(document).not.toContain('```md')
		expect(document).not.toContain('終わったこと')
	})
})

describe('the documents that name the hand-off report', () => {
	it.each([
		'.claude/skills/workflow-commands/backlogrun-progress.md',
		'prompts/collaboration-workflow/report-format.md',
	])('%s names the command', (file) => {
		expect(read_document(file)).toContain(COMMAND)
	})
})
