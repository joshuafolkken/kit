import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./main-merge', () => ({ main_merge: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'main:merge',
	entry: 'scripts/git/main-merge-main.ts',
	library: 'scripts/git/main-merge.ts',
	run,
})

describe('main-merge-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
