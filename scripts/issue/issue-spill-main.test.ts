import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-spill-cli', () => ({ issue_spill_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:spill',
	entry: 'scripts/issue/issue-spill-main.ts',
	library: 'scripts/issue/issue-spill-cli.ts',
	run,
})

describe('issue-spill-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
