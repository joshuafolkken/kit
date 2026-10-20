import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./plan-consumers-cli', () => ({ plan_consumers_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'plan:consumers',
	entry: 'scripts/issue/plan-consumers-main.ts',
	library: 'scripts/issue/plan-consumers-cli.ts',
	run,
})

describe('plan-consumers-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
