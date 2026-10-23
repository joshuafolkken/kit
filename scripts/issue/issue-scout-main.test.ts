import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-scout-cli', () => ({ issue_scout_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:scout',
	entry: 'scripts/issue/issue-scout-main.ts',
	library: 'scripts/issue/issue-scout-cli.ts',
	run,
})

describe('issue-scout-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
