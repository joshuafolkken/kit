import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./defect-rate-cli', () => ({ defect_rate_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'defect:rate',
	entry: 'scripts/issue/defect-rate-main.ts',
	library: 'scripts/issue/defect-rate-cli.ts',
	run,
})

describe('defect-rate-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
