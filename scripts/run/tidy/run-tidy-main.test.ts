import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { sweep } = vi.hoisted(() => ({ sweep: vi.fn() }))

vi.mock('./run-tidy-cli', () => ({ run_tidy_cli: { sweep } }))

const ENTRY = 'scripts/run/tidy/run-tidy-main.ts'
const PASS_THROUGH_CASE = 2

// The shared pass-through case expects an exit code back; the sweep answers none, so its own case
// stands in for that one.
const CASES = main_entry_fixture
	.entry_cases({
		command: 'run:tidy',
		entry: ENTRY,
		library: 'scripts/run/tidy/run-tidy-cli.ts',
		run: sweep,
	})
	.slice(0, PASS_THROUGH_CASE)

describe('run-tidy-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	it('runs the sweep once and leaves the exit code at success', async () => {
		sweep.mockReset()
		sweep.mockResolvedValue(undefined)

		expect(await main_entry_fixture.run_entry(ENTRY, [])).toBe(0)
		expect(sweep).toHaveBeenCalledOnce()
	})
})
