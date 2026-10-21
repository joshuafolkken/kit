import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run } = vi.hoisted(() => ({ run: vi.fn() }))

vi.mock('./run-board-cli', () => ({ run_board_cli: { run } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'run:board',
	entry: 'scripts/run/board/run-board-main.ts',
	library: 'scripts/run/board/run-board-cli.ts',
	run,
})

describe('run-board-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
