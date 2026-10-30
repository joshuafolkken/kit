import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const DIRECTORY = '.claude/skills/workflow-commands'

function document(file: string): string {
	return readFileSync(`${DIRECTORY}/${file}`, 'utf8').replaceAll(/\s+/gu, ' ')
}

describe('fullrun entry in an existing linked checkout', () => {
	it('chooses primary sync and linked merge without changing the linked branch', () => {
		const entry = document('entry-sequence.md')

		expect(entry).toContain('primary checkout → `pnpm josh ms`')
		expect(entry).toContain('linked checkout → `pnpm josh main:merge`')
		expect(entry).toContain('`start: gate` skips `run:step`, planning and implementation')
		expect(entry).toContain("Honor prep's stop and update verdicts first")
	})

	it('keeps the fullrun step list on the shared entry decision', () => {
		expect(document('fullrun-steps.md')).toContain(
			'Synchronize as `entry-sequence.md` → "The ordered entry sequence" directs',
		)
	})
})
