import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIRECTORY = '.claude/skills/workflow-commands'

function document(file: string): string {
	return readFileSync(`${DIRECTORY}/${file}`, 'utf8').replaceAll(/\s+/gu, ' ')
}

describe('fullrun entry in an existing linked checkout', () => {
	// joshuafolkken/kit#5943: `run:entry` runs the primary sync or the linked merge itself
	// (`run-entry-sync.test.ts`), so the documents point at it rather than naming the commands.
	it('points the entry sequence at the sync run:entry runs', () => {
		const entry = document('entry-sequence.md')

		expect(entry).toContain('`run:entry` has already merged main')
		expect(entry).not.toContain('primary checkout → `pnpm josh ms`')
		expect(entry).toContain('`start: gate` skips `run:step`, planning and implementation')
		expect(entry).toContain("Honor prep's stop and update verdicts first")
	})

	it('keeps the fullrun step list on the sync run:entry ran', () => {
		expect(document('fullrun-steps.md')).toContain('`run:entry` has synchronized the tree')
	})
})
