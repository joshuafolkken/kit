import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./bump-version', () => ({ run_bump_version: run }))

const CASES = main_entry_fixture.entry_cases({
	command: 'bump',
	entry: 'scripts/version/bump-version-main.ts',
	library: 'scripts/version/bump-version.ts',
	run,
})

describe('bump-version-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
