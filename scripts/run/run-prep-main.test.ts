import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-prep-cli', () => ({ run_prep_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'run:prep',
	entry: 'scripts/run/run-prep-main.ts',
	library: 'scripts/run/run-prep-cli.ts',
	run,
})

describe('run-prep-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
