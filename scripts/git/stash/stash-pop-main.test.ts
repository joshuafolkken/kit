import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./stash-pop-cli', () => ({ stash_pop_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'stash:pop',
	entry: 'scripts/git/stash/stash-pop-main.ts',
	library: 'scripts/git/stash/stash-pop-cli.ts',
	run,
})

describe('stash-pop-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
