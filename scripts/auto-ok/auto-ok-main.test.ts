import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./auto-ok-cli', () => ({ auto_ok_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'auto-ok:next',
	entry: 'scripts/auto-ok/auto-ok-main.ts',
	library: 'scripts/auto-ok/auto-ok-cli.ts',
	run,
})

describe('auto-ok-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
