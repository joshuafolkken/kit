import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-file-cli', () => ({ issue_file_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:file',
	entry: 'scripts/issue/issue-file-main.ts',
	library: 'scripts/issue/issue-file-cli.ts',
	run,
})

describe('issue-file-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
