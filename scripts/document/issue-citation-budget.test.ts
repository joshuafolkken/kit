import { readFileSync } from 'node:fs'
import { package_file } from '#scripts/claude/skill-fixture'
import { describe, expect, it } from 'vitest'
import { agent_read_documents } from './ai-document-fixture'
import { issue_citation_budget } from './issue-citation-budget'

const { ISSUE_CITATION_BUDGET, citation_violation, count_citations, recorded_citations_for } =
	issue_citation_budget

const EXAMPLE_PATH = 'prompts/example.md'
const RECORDED = 3

function citations_in(relative_path: string): number {
	return count_citations(readFileSync(package_file(relative_path), 'utf8'))
}

describe('agent-read document issue-citation budget', () => {
	it.each(agent_read_documents())('%s cites exactly its recorded count', (path) => {
		const violation = citation_violation(path, citations_in(path), recorded_citations_for(path))

		expect(violation).toBeUndefined()
	})

	it('names only agent-read documents, so no entry outlives its file', () => {
		const documents = new Set(agent_read_documents())
		const stale = ISSUE_CITATION_BUDGET.filter((entry) => !documents.has(entry.path))

		expect(stale).toEqual([])
	})

	it('records no zero entry — an absent document already has a ceiling of zero', () => {
		const zero = ISSUE_CITATION_BUDGET.filter((entry) => entry.citations === 0)

		expect(zero).toEqual([])
	})
})

describe('count_citations', () => {
	it('counts a bare and a repository-qualified issue number', () => {
		expect(count_citations('See #3185 and joshuafolkken/kit#2257.')).toBe(2)
	})

	it('ignores placeholders and short ordinals', () => {
		expect(count_citations('Run `fullrun #N` or `#<N>`; step #12.')).toBe(0)
	})
})

describe('citation_violation — the ratchet', () => {
	it('passes a document at its recorded count', () => {
		expect(citation_violation(EXAMPLE_PATH, RECORDED, RECORDED)).toBeUndefined()
	})

	it('refuses one added citation and names the value to record', () => {
		const message = citation_violation(EXAMPLE_PATH, RECORDED + 1, RECORDED)

		expect(message).toContain('over its ceiling of 3')
		expect(message).toContain('record 4 in scripts/document/issue-citation-budget.ts')
	})

	it('refuses a reduction left unrecorded, so the ceiling follows the count down', () => {
		const message = citation_violation(EXAMPLE_PATH, RECORDED - 1, RECORDED)

		expect(message).toContain('lower its entry to 2')
	})

	it('treats a document with no entry as a ceiling of zero', () => {
		expect(recorded_citations_for(EXAMPLE_PATH)).toBe(0)
	})
})
