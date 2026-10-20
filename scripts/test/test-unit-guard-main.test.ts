import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./test-unit-guard', () => ({ test_unit_guard: { run_guarded_unit: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'test:unit',
	entry: 'scripts/test/test-unit-guard-main.ts',
	library: 'scripts/test/test-unit-guard.ts',
	run,
	called_with: [process.cwd(), main_entry_fixture.ARGUMENTS],
})

describe('test-unit-guard-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
