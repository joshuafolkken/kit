import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-stale-cli', () => ({ run_stale_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'run:stale',
	entry: 'scripts/run/stale/run-stale-main.ts',
	library: 'scripts/run/stale/run-stale-cli.ts',
	run,
	called_with: [],
})

describe('run-stale-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
