import { auto_ok_fixture, CREATED_LATER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'

const LIMIT = 4
const COUNT = 7
const FIRST = 901
const ISSUES = Array.from({ length: COUNT }, (_, index) => FIRST + index)
const ORDERED = ISSUES
const WORD_CASES: ReadonlyArray<readonly [string, string, string]> = [
	[
		'ja',
		'今すぐ着手可 — 最初の組。並行に流せる:',
		'後続の組を待つ（レーン上限または選択条件による）',
	],
	[
		'en',
		'Ready now — the first wave; these may run in parallel:',
		'waiting for a later wave (lane limit or selection gates)',
	],
]

function numbers_in(text: string): Array<number> {
	return [...text.matchAll(/\[#(\d+)\]/gu)].map((match) => Number(match[1]))
}

function stub(): void {
	const rows = ISSUES.map((number) => auto_ok_fixture.issue(number, CREATED_LATER, [AUTO_OK_LABEL]))

	backlog_fixture.stub_backlog({ opted_in: rows })
	vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: LIMIT })
	vi.spyOn(git_gh_command, 'issue_list_recent').mockResolvedValue({
		json: JSON.stringify(rows),
		is_capped: false,
	})
}

const backlog_plan_cap_fixture = { LIMIT, ORDERED, WORD_CASES, numbers_in, stub }

export { backlog_plan_cap_fixture }
