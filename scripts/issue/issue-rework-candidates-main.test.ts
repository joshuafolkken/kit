import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./issue-rework-candidates-cli', () => ({ issue_rework_candidates_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:rework-candidates',
	entry: 'scripts/issue/issue-rework-candidates-main.ts',
	library: 'scripts/issue/issue-rework-candidates-cli.ts',
	run,
})

describe('issue-rework-candidates-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
