import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./cost-cli', () => ({ cost_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'cost',
	entry: 'scripts/cost-runtime/cost-main.ts',
	library: 'scripts/cost-runtime/cost-cli.ts',
	run,
})

describe('cost-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
