import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./stash-push-cli', () => ({ stash_push_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'stash:push',
	entry: 'scripts/git/stash/stash-push-main.ts',
	library: 'scripts/git/stash/stash-push-cli.ts',
	run,
})

describe('stash-push-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
