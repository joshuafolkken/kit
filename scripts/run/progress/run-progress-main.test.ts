import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-progress-cli', () => ({ run_progress_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'run:progress',
	entry: 'scripts/run/progress/run-progress-main.ts',
	library: 'scripts/run/progress/run-progress-cli.ts',
	run,
})

describe('run-progress-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
