import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#6836: an `--only` run's scope left out the issues `run:add` handed it, so the board
// drew none of the issues the driver dispatched next.

const { CARRY, arrange } = run_board_read_fixture
const ADDED = [{ issue: 3500, is_priority: true }]

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local added issues', () => {
	it('scopes the running run to the issues run:add handed it too', async () => {
		const carry = { ...CARRY, invocation: 'backlogrun #3431 --only', added: ADDED }

		arrange({ kind: 'carried', carry }, undefined)

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			scope: { issues: [3500, 3431], only: true },
		})
	})
})
