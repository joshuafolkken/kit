import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-cite-cli', () => ({ issue_cite_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:cite',
	entry: 'scripts/issue/issue-cite-main.ts',
	library: 'scripts/issue/issue-cite-cli.ts',
	run,
})

describe('issue-cite-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
