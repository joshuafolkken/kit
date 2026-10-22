import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run, surface } = vi.hoisted(() => ({ run: vi.fn(), surface: vi.fn() }))

vi.mock('./test-related', () => ({ test_related: { run_related_tests: run } }))
vi.mock('#scripts/run/ship/run-ship-removed-rows', () => ({
	run_ship_removed_rows: { surface },
}))

const ENTRY = 'scripts/test/test-related-main.ts'
const FAILED = 1

const CASES = main_entry_fixture.entry_cases({
	command: 'test:related',
	entry: ENTRY,
	library: 'scripts/test/test-related.ts',
	run,
})

describe('test-related-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	// joshuafolkken/kit#4563: only a green run shows the removed tests, and a red one keeps its code.
	it.each([
		['a green run', 0, 1],
		['a failed run', FAILED, 0],
	])('surfaces the removed tests after %s as often as it should', async (_name, code, times) => {
		run.mockReset().mockResolvedValue(code)
		surface.mockClear()

		expect(await main_entry_fixture.run_entry(ENTRY, [])).toBe(code)
		expect(surface).toHaveBeenCalledTimes(times)
	})
})
