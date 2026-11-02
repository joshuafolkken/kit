import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#5885: the depth test's rows live in `observation-depth.ts` alone; the filing
// document points at `josh observation:depth` instead of holding a second copy of the table, and the
// ledger reads the record's depth off the same command. Matched against the unwrapped text so a line
// wrap cannot hide a marker.
const FILING = '.claude/skills/workflow-commands/observation-filing.md'
const LEDGER = '.claude/skills/workflow-commands/observation-ledger.md'
const COMMAND = 'pnpm josh observation:depth'

describe('the depth test points at josh observation:depth', () => {
	it('observation-filing.md points at the command and its single source', () => {
		const text = read_unwrapped(FILING)

		expect(text).toContain(`${COMMAND} <path>`)
		expect(text).toContain('`scripts/observations/observation-depth.ts`')
	})

	it('observation-filing.md no longer holds the rows itself', () => {
		const text = read_unwrapped(FILING)

		expect(text).not.toContain('| Depth | The subject | Where it lives |')
		expect(text).not.toContain('`josh cost` and the run-timing report')
	})

	it('observation-ledger.md takes the record depth from the command', () => {
		expect(read_unwrapped(LEDGER)).toContain(`\`d<n>\` → the token \`${COMMAND} <path>\` prints`)
	})

	it.each([
		[FILING, "A command subject → pass its script's path"],
		[LEDGER, "a command's being its script"],
	])('%s sends a command subject through its script path', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})
})
