import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/workflow-commands/SKILL.md', 'utf8')
const SCOUT = readFileSync('.claude/skills/workflow-commands/issue-scout.md', 'utf8')
const PROCEDURE = readFileSync('.claude/skills/workflow-commands/issue-fold-existing.md', 'utf8')
const REFERENCE = readFileSync('docs/josh-commands.md', 'utf8')

describe('existing issue fold procedure', () => {
	it('requires reading the candidate and its comments before assessment', () => {
		expect(SKILL).toContain('issue-scout.md')
		expect(SKILL).toContain('issue-fold-existing.md')
		expect(SCOUT).toContain('complete duplicate of an **open** Issue')
		expect(PROCEDURE).toContain('pnpm josh issue:read')
		expect(PROCEDURE).toContain('後のコメントを採る')
		expect(PROCEDURE).toContain('紐づく PR')
	})

	it('preserves the original and re-reads the edited issue', () => {
		expect(PROCEDURE).toContain('元の本文を保持')
		expect(PROCEDURE).toContain('再読して')
		expect(PROCEDURE).toContain('新しい Issue を作らない')
	})

	it('documents complete-draft input and the ordinary filing fallback', () => {
		expect(REFERENCE).toContain('--body-file draft.md')
		expect(REFERENCE).toContain('`separate` は従来の起票経路へ戻る')
	})
})
