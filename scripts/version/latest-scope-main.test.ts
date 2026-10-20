import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./latest-scope-cli', () => ({ latest_scope_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'latest:scope',
	entry: 'scripts/version/latest-scope-main.ts',
	library: 'scripts/version/latest-scope-cli.ts',
	run,
})

describe('latest-scope-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
