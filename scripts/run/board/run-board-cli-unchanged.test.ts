import { describe, expect, it } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'

const { LOCAL, harness, plan_titled } = run_board_fixture

describe('run_board_cli equal rereads', () => {
	it.each(['--chat', '--once'])(
		'preserves single-frame output after an equal reread for %s (ac-71e945f3)',
		async (argument) => {
			const plan = plan_titled('a')
			const board = harness(structuredClone(LOCAL), [plan, plan])
			const ports = { ...board.ports, gather: run_board_gather.frame_gatherer(board.gathering) }

			await run_board_cli.run([argument], ports)
			board.read_local.mockResolvedValue(structuredClone(LOCAL))
			await run_board_cli.run([argument], ports)

			expect(board.frames).toHaveLength(2)
			expect(board.frames[1]).toBe(board.frames[0])
		},
	)
})
