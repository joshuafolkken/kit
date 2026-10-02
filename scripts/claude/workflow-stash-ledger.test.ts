import { OBSERVATION_LEDGER_DIRECTORY } from '#scripts/observations/observation-ledger'
import { describe, expect, it } from 'vitest'
import { read_skill_file } from './skill-fixture'

const WORKFLOW_SKILL = '.claude/skills/workflow-commands'

// joshuafolkken/kit#2919: a `new` entry stashed the primary checkout's ledger lines with the other
// pre-existing changes, and the batch-end flush, reading `git status`, never saw them again. The stash
// now leaves the ledger out, so its lines stay in the tree and ride the run's own commit.
describe(`${WORKFLOW_SKILL} — the pre-work stash`, () => {
	it.each(['fullrun-steps.md', 'halfrun.md'])(
		'%s keeps the ledger out of its stash',
		(filename) => {
			const content = read_skill_file(WORKFLOW_SKILL, filename)

			expect(content).toContain(`-- ':!${OBSERVATION_LEDGER_DIRECTORY}'`)
		},
	)
})
