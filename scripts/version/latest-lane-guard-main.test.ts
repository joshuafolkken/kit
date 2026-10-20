import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./latest-lane-guard', () => ({ latest_lane_guard: { main: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'latest:guard',
	entry: 'scripts/version/latest-lane-guard-main.ts',
	library: 'scripts/version/latest-lane-guard.ts',
	run,
	called_with: [],
	has_own_exit_code: true,
})

describe('latest-lane-guard-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
