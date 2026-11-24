import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, it, vi } from 'vitest'

const { run, live_ports } = vi.hoisted(() => ({ run: vi.fn(), live_ports: vi.fn(() => 'ports') }))

vi.mock('./run-board-replay', () => ({ run_board_replay: { run } }))
vi.mock('./run-board-cli', () => ({ run_board_cli: { live_ports } }))

const CASES = main_entry_fixture.entry_cases({
	command: 'board:replay',
	entry: 'scripts/run/board/run-board-replay-main.ts',
	library: 'scripts/run/board/run-board-replay.ts',
	run,
	called_with: [main_entry_fixture.ARGUMENTS, 'ports'],
})

describe('run-board-replay-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})
})
