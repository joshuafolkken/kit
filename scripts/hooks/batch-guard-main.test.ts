import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run, stub } = vi.hoisted(() => ({ run: vi.fn(), stub: vi.fn() }))

vi.mock('./batch-guard', () => ({ batch_outcome: stub }))
vi.mock('#scripts/josh/hook-decision', () => ({ hook_decision: { respond_from_stdin: run } }))

const COMMAND = 'batch:guard'

const CASES = main_entry_fixture.entry_cases({
	command: COMMAND,
	entry: 'scripts/hooks/batch-guard-main.ts',
	library: 'scripts/hooks/batch-guard.ts',
	run,
	called_with: [COMMAND, stub],
	has_own_exit_code: true,
})

describe('batch-guard-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
