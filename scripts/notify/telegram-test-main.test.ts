import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./telegram-test', () => ({ telegram_test: { run_cli: run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'notify',
	entry: 'scripts/notify/telegram-test-main.ts',
	library: 'scripts/notify/telegram-test.ts',
	run,
	called_with: [],
	has_own_exit_code: true,
})

describe('telegram-test-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
