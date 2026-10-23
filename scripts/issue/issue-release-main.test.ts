import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-release-cli', () => ({ issue_release_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:release',
	entry: 'scripts/issue/issue-release-main.ts',
	library: 'scripts/issue/issue-release-cli.ts',
	run,
})

describe('issue-release-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
