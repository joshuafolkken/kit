import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./test-related', () => ({ test_related: { run_related_tests: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'test:related',
	entry: 'scripts/test/test-related-main.ts',
	library: 'scripts/test/test-related.ts',
	run,
})

describe('test-related-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
