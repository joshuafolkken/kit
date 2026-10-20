import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-state-cli', () => ({ issue_state_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:state',
	entry: 'scripts/issue/issue-state-main.ts',
	library: 'scripts/issue/issue-state-cli.ts',
	run,
})

describe('issue-state-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
