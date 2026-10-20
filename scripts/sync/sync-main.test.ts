import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./sync', () => ({ main: run }))

const CASES = main_entry_fixture.entry_cases({
	command: 'sync',
	entry: 'scripts/sync/sync-main.ts',
	library: 'scripts/sync/sync.ts',
	run,
	has_own_exit_code: true,
})

describe('sync-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
