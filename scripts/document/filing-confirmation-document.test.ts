import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#3538: filing without asking is for an unattended run only; an interactive session
// asks first. `observation-filing.md` is the single source, and `SKILL.md` and `CLAUDE.md` point at
// it. Matched against the unwrapped text so a line wrap cannot hide a marker.
const SOURCE = '.claude/skills/workflow-commands/observation-filing.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CLAUDE = 'CLAUDE.md'

describe('the filing confirmation rule has one source and two pointers', () => {
	it('observation-filing.md states the unattended / interactive split', () => {
		const text = read_unwrapped(SOURCE)

		expect(text).toContain(
			'An unattended run files without asking; an interactive session asks first',
		)
		expect(text).toContain('file it once the user confirms')
		expect(text).toContain('the `backlogrun` parent')
	})

	it.each([
		[SKILL, 'Unattended: file it (Tier A, first-party); else ask'],
		[CLAUDE, 'Unasked filing: unattended only (`observation-filing.md`)'],
	])('%s points at observation-filing.md for the split', (document_path, marker) => {
		const text = read_unwrapped(document_path)

		expect(text).toContain(marker)
		expect(text).toContain('observation-filing.md')
	})
})
