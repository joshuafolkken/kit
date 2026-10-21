import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./backlog-next', () => ({ backlog_next: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'backlog:next',
	entry: 'scripts/backlog/backlog-next-main.ts',
	library: 'scripts/backlog/backlog-next.ts',
	run,
})

describe('backlog-next-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
