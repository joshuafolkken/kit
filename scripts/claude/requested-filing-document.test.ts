import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3614: an Issue a person asked for is filed with `--requested`, so a live
// `backlogrun` carry record or an `auto-ok` branch Issue does not opt it in before the person chooses
// how to run it. Every `new` step that files the Issue declares it, and the words a person may type
// after `new` are defined in one table rather than left to each run's reading.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const REQUESTED_FILING =
	'pnpm josh issue:file "<title>" --body-file <body-file> --depth <n> --requested'
const NEW_STEP_DOCUMENTS = [
	`${WORKFLOW_SKILL}/kickoff.md`,
	`${WORKFLOW_SKILL}/halfrun.md`,
	`${WORKFLOW_SKILL}/fullrun-steps.md`,
]

describe.each(NEW_STEP_DOCUMENTS)('%s — the `new` filing a person asked for', (document) => {
	it('declares --requested on the filing', () => {
		expect(read_unwrapped(document)).toContain(REQUESTED_FILING)
	})

	it('points at the table of words typed after `new`', () => {
		expect(read_unwrapped(document)).toContain('"Words typed after `new`"')
	})
})

describe('kickoff.md — the multi-issue split of a `new` entry', () => {
	it('declares --requested on each split child', () => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toContain(
			'--depth <n> --route split --requested',
		)
	})
})

describe('kickoff.md — the words typed after `new`', () => {
	it.each([
		['auto ok', '`--label auto-ok --label run:lane`'],
		['high', '`--label priority:high`'],
	])('maps `%s` to %s', (word, flags) => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toContain(`| \`${word}\` | ${flags} |`)
	})
})
