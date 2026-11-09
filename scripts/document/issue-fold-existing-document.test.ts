import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SKILL = readFileSync('.claude/skills/workflow-commands/SKILL.md', 'utf8')
const SCOUT = readFileSync('.claude/skills/workflow-commands/issue-scout.md', 'utf8')
const PROCEDURE = readFileSync('.claude/skills/workflow-commands/issue-fold-existing.md', 'utf8')
const REFERENCE = readFileSync('docs/josh-commands-backlog.md', 'utf8')

describe('existing issue fold procedure', () => {
	it('requires reading the candidate and its comments before assessment', () => {
		expect(SKILL).toContain('issue-scout.md')
		expect(SCOUT).toContain('issue-fold-existing.md')
		expect(SCOUT).toContain('complete duplicate of an **open** Issue')
		expect(PROCEDURE).toContain('pnpm josh issue:read')
		expect(PROCEDURE).toContain('the later comment wins')
		expect(PROCEDURE).toContain('linked PRs')
	})

	it('preserves the original and writes through the verifying apply', () => {
		expect(PROCEDURE).toContain('keeps the original body')
		expect(PROCEDURE).toContain('pnpm josh issue:fold-existing assessment.json --apply <N>')
		expect(PROCEDURE).toContain('verifies the re-read')
		expect(PROCEDURE).toContain('never creates a new Issue')
	})

	it('records the comment fingerprint instead of a manual comment check', () => {
		const fingerprint_at = PROCEDURE.indexOf('pnpm josh issue:fold-existing --fingerprint <N>')

		expect(fingerprint_at).toBeGreaterThan(-1)
		expect(fingerprint_at).toBeLessThan(PROCEDURE.indexOf('pnpm josh issue:read <N>'))
		expect(PROCEDURE).toContain('the comments as `comment_fingerprint`')
		expect(PROCEDURE).not.toContain('confirm no comment has arrived')
	})

	it('names the required assessment fields in the procedure and the reference', () => {
		const required =
			'`content`, `has_complete_read`, `existing_body`, `comment_fingerprint`, `draft_body` and `verification` are required; an assessment without one exits 1'

		expect(PROCEDURE).toContain(required)
		expect(REFERENCE).toContain(required)
	})

	it('documents complete-draft input and the ordinary filing fallback', () => {
		expect(REFERENCE).toContain('--body-file .josh/tmp/draft.md')
		expect(REFERENCE).toContain('`separate` returns to the ordinary filing path')
	})
})

describe('split fold procedure', () => {
	it('documents the split fold that answers a split notice', () => {
		expect(PROCEDURE).toContain(
			'pnpm josh issue:fold-existing assessment.json --apply <N> --found-during <M>',
		)
		expect(REFERENCE).toContain('With `--found-during <M>` on `fold`')
		expect(REFERENCE).toContain(
			'pnpm josh issue:fold-existing assessment.json --apply 5848 --found-during 5849',
		)
	})
})
