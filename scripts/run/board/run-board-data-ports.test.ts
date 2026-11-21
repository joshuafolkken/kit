import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_closed } from './run-board-closed'
import { run_board_data_ports } from './run-board-data-ports'
import { run_board_fixture } from './run-board-fixture'
import { run_board_issue_count } from './run-board-issue-count'
import { run_board_plan_shared } from './run-board-plan-shared'
import { run_board_thanks_read } from './run-board-thanks-read'

// joshuafolkken/kit#8159: the GitHub, roster and snapshot reads a board steps its data through, wired
// once for the live board's worker thread and for a single frame.

const { LOCAL, plan_titled } = run_board_fixture
const PLAN = plan_titled('a')
const CLOSED = { closed: new Map(), is_whole: true }
const REPO = 'joshuafolkken/kit'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_data_ports.live', () => {
	it('reads the plan and the closed issues through the shared readers', async () => {
		vi.spyOn(run_board_plan_shared, 'read').mockResolvedValue(PLAN)
		vi.spyOn(run_board_closed, 'read_all').mockResolvedValue(CLOSED)
		const ports = run_board_data_ports.live()

		await expect(ports.read_plan(LOCAL.scope)).resolves.toBe(PLAN)
		await expect(ports.read_closed([1])).resolves.toBe(CLOSED)
	})

	it('reads the roster and the issue count through their readers', async () => {
		const thanks = vi.spyOn(run_board_thanks_read, 'read_thanks').mockResolvedValue([])
		const count = vi.spyOn(run_board_issue_count, 'read_issue_count').mockResolvedValue(undefined)
		const ports = run_board_data_ports.live()

		await ports.read_thanks?.()
		await ports.read_issue_count?.(REPO)

		expect(thanks).toHaveBeenCalledOnce()
		expect(count).toHaveBeenCalledWith(REPO)
	})

	it('reads the allowances with the session transport', async () => {
		vi.spyOn(gh_core_rate_limit, 'read_resources').mockResolvedValue({
			core: { remaining: 1, limit: 2, reset_ms: 0 },
			graphql: undefined,
		})
		vi.spyOn(git_gh_transport, 'known').mockResolvedValue('rest')

		await expect(run_board_data_ports.live().read_rate_limit?.()).resolves.toMatchObject({
			transport: 'rest',
		})
	})
})
