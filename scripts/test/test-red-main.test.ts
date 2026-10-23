import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./test-red', () => ({ test_red: { main: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'test:red',
	entry: 'scripts/test/test-red-main.ts',
	library: 'scripts/test/test-red.ts',
	run,
})

describe('test-red-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
