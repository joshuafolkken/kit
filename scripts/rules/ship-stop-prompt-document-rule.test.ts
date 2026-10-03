import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { run_ship_next } from '#scripts/run/run-ship-next'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2964. The ship-stop prompt carries the command that resumes a stopped stage, written
// once in `run-ship-next.ts`, while `chain-rule.md` stays the single source of the procedure. This holds
// the two together: every command the prompt can name is one `chain-rule.md` names, so a rename in the
// document fails here rather than leaving the prompt pointing at a command the chain no longer runs.

const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const WHITESPACE = /\s+/gu

describe('the ship-stop prompt commands', () => {
	// Line wraps in the document are not part of a command, so both sides compare on single spaces.
	const document = read_repo_file(CHAIN_RULE).replaceAll(WHITESPACE, ' ')

	it.each(Object.values(run_ship_next.COMMAND))('names %s as chain-rule.md does', (command) => {
		expect(document).toContain(command)
	})
})
