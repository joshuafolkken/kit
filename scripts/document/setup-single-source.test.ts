import { describe, expect, it } from 'vitest'
import { linked_paths, read_document } from './ai-document-fixture'
import { document_section } from './document-section'

// Each setup explanation has one home (joshuafolkken/kit#2897): the init-or-start choice lives in
// init.md, the self-sync refusal in sync.md, and the josh subcommands in josh-commands.md. The other
// pages link to that home, so these tests fail when a restated copy comes back.
const INIT = 'docs/init.md'
const SYNC = 'docs/sync.md'
const COMMANDS = 'docs/josh-commands.md'
const FULL_SETUP = 'docs/setup/full.md'
const INIT_RATIONALE = 'docs/maintainers/init-rationale.md'
const CHOICE_HEADING = '`josh init` or `josh start`'
const CHOICE_ANCHOR = '../init.md#josh-init-or-josh-start'
const DECISION_QUESTION = 'will this project use the GitHub Issue workflow'
const REFUSAL_HEADING = "Refused inside the distribution package's own repository"
const INIT_REFUSAL_HEADING = "Refused inside the package's own repository"
const REFUSAL_MESSAGE = "Refusing to sync: this is @joshuafolkken/kit's own repository."
const SUBCOMMANDS_HEADING = 'Available `pnpm josh` subcommands'
const RETIRED_HEADING = 'Retired package scripts'
const SINGLE_SOURCE = 'single source'
const FORMER_TABLE_COMMANDS: ReadonlyArray<string> = [
	'lint',
	'format',
	'cspell:dot',
	'test:unit',
	'main:sync',
	'main:merge',
	'check',
]

function section_text(path: string, heading: string): string {
	const found = document_section.section(read_document(path), heading)

	expect(found, `${path} → ${heading}`).toBeDefined()

	return found?.text ?? ''
}

describe('the init-or-start choice', () => {
	it('is declared the single source in init.md', () => {
		const text = section_text(INIT, CHOICE_HEADING)

		expect(text).toContain(SINGLE_SOURCE)
		expect(text).toContain(DECISION_QUESTION)
	})

	it('is linked, not restated, by the full setup guide', () => {
		const text = section_text(FULL_SETUP, '1. Choose `josh init` or `josh start`')

		expect(text).toContain(CHOICE_ANCHOR)
		expect(text).not.toContain(DECISION_QUESTION)
	})
})

describe('the self-sync refusal', () => {
	it('is declared the single source in sync.md', () => {
		const text = section_text(SYNC, REFUSAL_HEADING)

		expect(text).toContain(SINGLE_SOURCE)
		expect(text).toContain(REFUSAL_MESSAGE)
	})

	it('is linked from init.md without repeating the message', () => {
		const text = section_text(INIT, INIT_REFUSAL_HEADING)

		expect(text).toContain('./sync.md#refused-inside-the-distribution-packages-own-repository')
		expect(text).not.toContain(REFUSAL_MESSAGE)
	})
})

describe('the josh subcommands', () => {
	it('are linked from init.md rather than tabulated', () => {
		const text = section_text(INIT, SUBCOMMANDS_HEADING)

		expect(text).not.toContain('| Command')
		expect(linked_paths(INIT)).toContain(COMMANDS)
	})

	it.each(FORMER_TABLE_COMMANDS)('josh-commands.md documents josh %s', (command) => {
		expect(read_document(COMMANDS)).toContain(`### \`josh ${command}\``)
	})

	it('keeps the retired package scripts in the init rationale', () => {
		expect(section_text(INIT_RATIONALE, RETIRED_HEADING)).toContain('check:svelte:ci')
		expect(linked_paths(INIT)).toContain(INIT_RATIONALE)
	})
})
