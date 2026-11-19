import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_human_merge } from './run-board-human-merge'
import type { BoardPlan } from './run-board-layout'

const BLOCKER = 6300
const PR = 6301
const REPO = 'joshuafolkken/kit'

function plan_of(): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([BLOCKER]) },
		labels: new Map(),
		decision_blockers: [
			{ number: BLOCKER, title: 'Blocker', labels: [], need: 'merge', blocks: [] },
		],
	}
}

afterEach(() => vi.restoreAllMocks())

describe('run_board_human_merge decision blockers', () => {
	it('pairs an open PR for a decision blocker with no merge label in the plan', async () => {
		const body = JSON.stringify([
			{ number: PR, body: `closes #${String(BLOCKER)}` },
			{ number: 1, body: 'closes #1' },
		])
		const read = vi.spyOn(git_gh_etag_read, 'read_listing').mockResolvedValue(body)

		expect(await run_board_human_merge.read_prs(plan_of())).toEqual(new Map([[BLOCKER, PR]]))
		expect(read).toHaveBeenCalledTimes(1)
	})
})
