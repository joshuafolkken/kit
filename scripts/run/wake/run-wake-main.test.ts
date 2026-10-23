import path from 'node:path'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'
import type { run_wake_cli as RunWakeCli } from './run-wake-cli'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-wake-cli', () => ({ run_wake_cli: { run } }))

const ENTRY = 'scripts/run/wake/run-wake-main.ts'

const CASES = main_entry_fixture.entry_cases({
	command: 'run:wake',
	entry: ENTRY,
	library: 'scripts/run/wake/run-wake-cli.ts',
	run,
})

describe('run-wake-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	// `--start` spawns this path with `--loop`, so it has to be the file that runs `main`.
	it('is the script the supervisor spawns', async () => {
		const actual = await vi.importActual<{ run_wake_cli: typeof RunWakeCli }>(
			'#scripts/run/wake/run-wake-cli',
		)

		expect(actual.run_wake_cli.SCRIPT_PATH).toBe(path.resolve(ENTRY))
	})
})
