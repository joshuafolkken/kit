import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-hold-cli', () => ({ run_hold_cli: { run } }))

// `run:release` runs the same entry; the dispatcher adds its `--release` flag.
const CASES = ['run:hold', 'run:release'].flatMap((command) =>
	main_entry_fixture
		.entry_cases({
			command,
			entry: 'scripts/run/hold/run-hold-main.ts',
			library: 'scripts/run/hold/run-hold-cli.ts',
			run,
		})
		.map(([name, check]) => [`${command}: ${name}`, check] as const),
)

describe('run-hold-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
