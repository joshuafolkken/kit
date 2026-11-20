import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-wait-cli', () => ({ run_wait_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'wait',
	entry: 'scripts/run/run-wait-main.ts',
	library: 'scripts/run/run-wait-cli.ts',
	run,
})

describe('run-wait-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
