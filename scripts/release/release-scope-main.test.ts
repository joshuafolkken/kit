import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./release-scope-cli', () => ({ release_scope_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'release:scope',
	entry: 'scripts/release/release-scope-main.ts',
	library: 'scripts/release/release-scope-cli.ts',
	run,
})

describe('release-scope-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
