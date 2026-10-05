import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/workflow-commands/SKILL.md', 'utf8')
const SCOUT = readFileSync('.claude/skills/workflow-commands/issue-scout.md', 'utf8')
const PROCEDURE = readFileSync('.claude/skills/workflow-commands/issue-fold-existing.md', 'utf8')
const REFERENCE = readFileSync('docs/josh-commands-automation.md', 'utf8')

describe('existing issue fold procedure', () => {
	it('requires reading the candidate and its comments before assessment', () => {
		expect(SKILL).toContain('issue-scout.md')
		expect(SCOUT).toContain('issue-fold-existing.md')
		expect(SCOUT).toContain('complete duplicate of an **open** Issue')
		expect(PROCEDURE).toContain('pnpm josh issue:read')
		expect(PROCEDURE).toContain('the later comment wins')
		expect(PROCEDURE).toContain('linked PRs')
	})

	it('preserves the original and re-reads the edited issue', () => {
		expect(PROCEDURE).toContain('keeps the original body')
		expect(PROCEDURE).toContain('Re-read it')
		expect(PROCEDURE).toContain('never creates a new Issue')
	})

	it('documents complete-draft input and the ordinary filing fallback', () => {
		expect(REFERENCE).toContain('--body-file draft.md')
		expect(REFERENCE).toContain('`separate` returns to the ordinary filing path')
	})
})
