import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#6738: a backlogrun parent is `backlog:drive`, which files nothing and adds nothing to
// the run, so an interrupt a child returned to it waited on a person. The child files the interrupt
// and adds it to the run itself. Matched against the unwrapped text so a line wrap cannot hide a marker.
const FILING = '.claude/skills/workflow-commands/observation-filing.md'

describe('a backlogrun child files its own interrupt', () => {
	it.each([
		[
			'files with the interrupt route and its finder',
			'pnpm josh issue:file --route interrupt --found-during <N>',
		],
		['adds the filed issue to the run', 'pnpm josh run:add <M>'],
		[
			'names the driver parent as the reason',
			"A `backlogrun` child's parent is a driver with no person, so it files an interrupt itself",
		],
	])('observation-filing.md %s', (_case, marker) => {
		expect(read_unwrapped(FILING)).toContain(marker)
	})
})
