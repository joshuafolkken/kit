import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#3853: `auto-ok` is judged by `issue:file` from the criteria whoever asked for
// the Issue, so no `new` step declares `--requested` any more. The words a person may type after
// `new` are still defined in one table rather than left to each run's reading.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const NEW_FILING = 'pnpm josh issue:file "<title>" --body-file <body-file> --depth <n>`'
const NEW_STEP_DOCUMENTS = [
	`${WORKFLOW_SKILL}/kickoff.md`,
	`${WORKFLOW_SKILL}/halfrun.md`,
	`${WORKFLOW_SKILL}/fullrun-steps.md`,
]

describe.each(NEW_STEP_DOCUMENTS)('%s — the `new` filing a person asked for', (document) => {
	it('files without the retired --requested', () => {
		const text = read_unwrapped(document)

		expect(text).toContain(NEW_FILING)
		expect(text).not.toContain('--requested')
	})

	it('points at the table of words typed after `new`', () => {
		expect(read_unwrapped(document)).toContain('"Words typed after `new`"')
	})
})

describe('kickoff.md — the multi-issue split of a `new` entry', () => {
	it('files each split child without --requested', () => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toContain(
			'--depth <n> --route split` plus the labels',
		)
	})
})

describe('kickoff.md — the words typed after `new`', () => {
	it.each([
		['auto ok', /\| `auto ok` \| nothing — `issue:file` judges it\s*\|/u],
		['high', /\| `high` \s*\| `--label priority:high`\s*\|/u],
	])('maps `%s` in the table', (_word, row) => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/kickoff.md`)).toMatch(row)
	})
})
