import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// The first-party/third-party test is computed by `josh repo:party` now, not restated as prose in
// three places (joshuafolkken/kit#2122). `upstream-interrupt.md` stays the single-source reference and
// names the command; `CLAUDE.md` and `SKILL.md` point at it rather than repeating the manual judging
// procedure. Matched against the unwrapped text so a line wrap inside a code span cannot hide a marker.

const COMMAND = 'pnpm josh repo:party'
// The manual `gh api … --jq .owner.login` these documents used to restate. Its absence is what proves
// the procedure moved to the command rather than being duplicated beside it.
const MANUAL_PROCEDURE = '--jq .owner.login'

const CLAUDE = 'CLAUDE.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const UPSTREAM = 'prompts/collaboration-workflow/upstream-interrupt.md'

describe('the first-party/third-party test points at the command', () => {
	it.each([CLAUDE, SKILL, UPSTREAM])('%s names the command', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(COMMAND)
	})

	it.each([CLAUDE, SKILL, UPSTREAM])(
		'%s does not restate the manual judging procedure',
		(document_path) => {
			expect(read_unwrapped(document_path)).not.toContain(MANUAL_PROCEDURE)
		},
	)

	// The guard is only worth keeping if it fails on the thing it exists to catch.
	it('would flag a document that restated the procedure', () => {
		expect(`decided by \`gh api repos/owner/repo ${MANUAL_PROCEDURE}\``).toContain(MANUAL_PROCEDURE)
	})
})
