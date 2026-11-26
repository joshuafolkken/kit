import { describe, it } from 'vitest'
import { run_board_motion_board_fixture } from './run-board-motion-board-fixture'

const { TIMEOUT_MS, VALUES, board_of, expect_motion } = run_board_motion_board_fixture
const BOARD = board_of(240, 40)

describe('run_board_motion_check — every theme on 240x40', () => {
	it.each(VALUES)(
		'%s keeps every motion rule in every scene',
		async (value) => {
			await expect_motion(BOARD, value)
		},
		TIMEOUT_MS,
	)
})
