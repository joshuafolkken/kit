import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-read-cli', () => ({ issue_read_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:read',
	entry: 'scripts/issue/issue-read-main.ts',
	library: 'scripts/issue/issue-read-cli.ts',
	run,
})

describe('issue-read-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
