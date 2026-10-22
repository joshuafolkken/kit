import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./lane-launch-cli', () => ({ lane_launch_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'lane:launch',
	entry: 'scripts/lane/lane-launch-main.ts',
	library: 'scripts/lane/lane-launch-cli.ts',
	run,
})

describe('lane-launch-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
