import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { AUTO_OK_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { lane_plan } from '#scripts/lane/lane-plan'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan } from './backlog-plan'
import { backlog_plan_cli } from './backlog-plan-cli'

// joshuafolkken/kit#5299: "Ready now" printed the rank alone while each wave put a yielded issue first,
// so wave 2 read in another order than the list above it. Kept apart from `backlog-plan.test.ts`,
// which is at its line limit.

const { console_streams } = auto_ok_fixture

// One timestamp, so the rank is the number order, highest first; the yielded one ranks last.
const RANKED_FIRST = 807
const RANKED_SECOND = 806
const YIELDED = 805

const streams = console_streams()
const { stdout } = streams

// The open listing holds the same rows, so their titles resolve and none is out of scope.
function stub_pool(): void {
	const rows = [RANKED_FIRST, RANKED_SECOND, YIELDED].map((number) =>
		auto_ok_fixture.issue(number, CREATED_EARLIER, [AUTO_OK_LABEL, RUN_LANE_LABEL]),
	)

	backlog_fixture.stub_backlog({ opted_in: rows, in_progress: [] })
	vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
		json: JSON.stringify(rows),
		is_capped: false,
	})
}

// The "Ready now" rows' numbers, in the order they are printed.
function ready_numbers(): Array<number> {
	const ready = stdout().split(backlog_plan.READY_HEADING)[1] ?? ''
	const section = ready.split('\n\n', 1)[0] ?? ''

	return [...section.matchAll(/#(\d+)/gu)].map((match) => Number(match[1]))
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:plan — "Ready now" in the order the offer walks it', () => {
	it('prints an issue whose lane yielded ahead of the rank', async () => {
		stub_pool()
		vi.spyOn(lane_plan, 'is_yielded').mockImplementation((issue) => issue === YIELDED)

		await backlog_plan_cli.run([])

		expect(ready_numbers()).toStrictEqual([YIELDED, RANKED_FIRST, RANKED_SECOND])
	})

	it('prints the rank alone when no lane yielded', async () => {
		stub_pool()
		vi.spyOn(lane_plan, 'is_yielded').mockReturnValue(false)

		await backlog_plan_cli.run([])

		expect(ready_numbers()).toStrictEqual([RANKED_FIRST, RANKED_SECOND, YIELDED])
	})
})
