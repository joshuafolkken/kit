import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./lint-parallel', () => ({ lint_parallel: { run_lint_command: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'lint',
	entry: 'scripts/lint/lint-parallel-main.ts',
	library: 'scripts/lint/lint-parallel.ts',
	run,
})

describe('lint-parallel-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
