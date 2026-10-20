import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./check-commit-message', () => ({ run_check: run }))

const CASES = main_entry_fixture.entry_cases({
	command: 'check-commit-message',
	entry: 'scripts/hooks/check-commit-message-main.ts',
	library: 'scripts/hooks/check-commit-message.ts',
	run,
	called_with: [],
})

describe('check-commit-message-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
