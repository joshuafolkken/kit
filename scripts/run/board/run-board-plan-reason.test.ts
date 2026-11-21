import { backlog_plan_read } from '#scripts/backlog/backlog-plan-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_plan } from './run-board-plan'

// joshuafolkken/kit#8507: the board's plan read answered a gh failure as `undefined`, so its fetch had
// no reason to put in `plan_error` and the notice slot could only say `retrying`.

const REASON = 'gh CLI is not installed. Install it from https://cli.github.com/'
const LISTING = { rows: [], is_capped: false }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_plan.fetch_open_or_reason', () => {
	it('rejects with gh’s reason when the listing was not read', async () => {
		vi.spyOn(backlog_plan_read, 'read_open').mockResolvedValue({
			listing: undefined,
			error: REASON,
		})

		await expect(run_board_plan.fetch_open_or_reason()).rejects.toThrow(REASON)
	})

	it('answers a listing read but not parsed as nothing, with no reason to reject with', async () => {
		vi.spyOn(backlog_plan_read, 'read_open').mockResolvedValue({ listing: undefined })

		await expect(run_board_plan.fetch_open_or_reason()).resolves.toBeUndefined()
	})

	it('answers the listing it read', async () => {
		vi.spyOn(backlog_plan_read, 'read_open').mockResolvedValue({ listing: LISTING })

		await expect(run_board_plan.fetch_open_or_reason()).resolves.toBe(LISTING)
	})
})
