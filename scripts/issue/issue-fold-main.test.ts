import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-fold-cli', () => ({ issue_fold_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:fold',
	entry: 'scripts/issue/issue-fold-main.ts',
	library: 'scripts/issue/issue-fold-cli.ts',
	run,
})

describe('issue-fold-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
