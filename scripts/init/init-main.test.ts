import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./init', () => ({ run_cli: run }))

const CASES = main_entry_fixture.entry_cases({
	command: 'init',
	entry: 'scripts/init/init-main.ts',
	library: 'scripts/init/init.ts',
	run,
	has_own_exit_code: true,
})

describe('init-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
