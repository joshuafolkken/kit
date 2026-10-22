import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./defect-origin-cli', () => ({ defect_origin_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'defect:origin',
	entry: 'scripts/issue/defect-origin-main.ts',
	library: 'scripts/issue/defect-origin-cli.ts',
	run,
})

describe('defect-origin-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
