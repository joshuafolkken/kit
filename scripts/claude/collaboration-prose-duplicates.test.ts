import { read_repo_file, WORKFLOW_PROMPT_DIRECTORY } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#6042: each rule a hook, CLAUDE.md or a skill already holds is pointed at, not
// restated, so the two copies cannot drift.
const RESIDENCY = 'residency.md'
const RULE_DELIVERY = 'rule-delivery.md'
const NOT_RESTATED = 'does not restate %j'

function read_topic(file_name: string): string {
	return read_repo_file(`${WORKFLOW_PROMPT_DIRECTORY}/${file_name}`)
}

describe('principles.md points at the hook that enforces the consultation shell', () => {
	const principles = read_topic('principles.md')

	it('names the enforcing hook', () => {
		expect(principles).toContain('`scripts/hooks/implementation-shell.ts` が強制する')
	})

	it.each(['`pnpm view`', '`-X GET`', 'リダイレクト'])(NOT_RESTATED, (marker) => {
		expect(principles).not.toContain(marker)
	})
})

describe('rule-delivery.md and residency.md delegate in one direction', () => {
	it('residency.md points at rule-delivery.md', () => {
		expect(read_topic(RESIDENCY)).toContain(RULE_DELIVERY)
	})

	it('rule-delivery.md does not point back at residency.md', () => {
		expect(read_topic(RULE_DELIVERY)).not.toContain(RESIDENCY)
	})

	it('rule-delivery.md carries no pointer-only concise-reply section', () => {
		expect(read_topic(RULE_DELIVERY)).not.toContain('## concise-reply')
	})
})

describe('overview.md leaves the workflow steps to the skill', () => {
	const overview = read_topic('overview.md')

	it('points at the workflow-commands skill', () => {
		expect(overview).toContain('`workflow-commands` skill')
	})

	it.each(['### フェーズ分離', 'UserPromptSubmit'])(NOT_RESTATED, (marker) => {
		expect(overview).not.toContain(marker)
	})
})
