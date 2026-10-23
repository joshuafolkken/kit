import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./main-sync', () => ({ main_sync: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'main:sync',
	entry: 'scripts/git/main-sync-main.ts',
	library: 'scripts/git/main-sync.ts',
	run,
})

describe('main-sync-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
