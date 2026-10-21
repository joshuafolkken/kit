import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./backlog-budget-cli', () => ({ backlog_budget_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'backlog:budget',
	entry: 'scripts/backlog/backlog-budget-main.ts',
	library: 'scripts/backlog/backlog-budget-cli.ts',
	run,
})

describe('backlog-budget-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
