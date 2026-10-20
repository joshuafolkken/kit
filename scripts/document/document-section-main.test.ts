import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./document-section-cli', () => ({ document_section_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'doc:section',
	entry: 'scripts/document/document-section-main.ts',
	library: 'scripts/document/document-section-cli.ts',
	run,
})

describe('document-section-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
