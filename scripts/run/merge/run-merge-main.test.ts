import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-merge-cli', () => ({ run_merge_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'run:merge',
	entry: 'scripts/run/merge/run-merge-main.ts',
	library: 'scripts/run/merge/run-merge-cli.ts',
	run,
})

describe('run-merge-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
