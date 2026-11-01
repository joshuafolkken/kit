import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-ship-wait-cli', () => ({ run_ship_wait_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'ship:wait',
	entry: 'scripts/run/ship/run-ship-wait-main.ts',
	library: 'scripts/run/ship/run-ship-wait-cli.ts',
	run,
})

describe('run-ship-wait-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
