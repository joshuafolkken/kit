import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { line_budget } from '#scripts/lines/line-budget'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_check } from './lane-plan-check'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7183: a dispatched lane is never split by its size — the overrun is warned once,
// on its first plan, and the lane goes on to the end. No split notice is noted, since no split child
// can answer it; the merge's size entry records the overrun as a pre-split miss.

const ROOT = make_directory('lane-plan-check-dispatched-')
const LANE = 5171
const OTHER = 5172
const FILE = 'scripts/followup/followup-job-rerun.ts'
const PROBED = 'scripts/lane/probed.ts'
const SUCCESS = 0
const LISTING_LIMIT = 100
const DECLARED = '## 背景\n\n- 規模見積もり: 約 1 ファイル / 20 行（テスト除く）\n'
const PLAN = [String(LANE), FILE]
const WARNING = 'size warning (hunks)'

const fetch_opted_in = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
const error = vi.spyOn(console, 'error')
const info = vi.spyOn(console, 'info')
const signals_of = vi.spyOn(lane_plan_signals, 'signals_of')
const record_split_notice = vi.spyOn(lane_ledger_write, 'record_split_notice')
const QUIET = lane_plan_signals.signals_from(LANE, { hunk_files: [], committed_files: [] }, [], 0)
const directory = path.join(ROOT, 'lane')

function listing(): Awaited<ReturnType<typeof auto_ok_cli.fetch_opted_in>> {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]
	const issues: Array<OpenIssueData> = [
		{ number: LANE, title: 'running', createdAt: '2026-10-27T11:00:00Z', labels, body: DECLARED },
	]

	return { kind: 'read', issues, cutoff: cutoff_of(issues.length, LISTING_LIMIT, false) }
}

function warnings(): number {
	return error.mock.calls.filter((call) => String(call[0]).includes(WARNING)).length
}

beforeEach(() => {
	vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
	signals_of.mockResolvedValue({ ...QUIET, hunk_files: [PROBED, PROBED, PROBED] })
	record_split_notice.mockResolvedValue(undefined)
	error.mockImplementation(vi.fn())
	info.mockImplementation(vi.fn())
	fetch_opted_in.mockResolvedValue(listing())
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
	vi.stubEnv(lane_child_marker.KEY, String(LANE))
})

describe('lane:plan in a dispatched lane over its size bar', () => {
	it('records the plan instead of answering `split`, warning once and noting no split notice', async () => {
		expect(await lane_plan_cli.run(PLAN, directory)).toBe(SUCCESS)
		expect(await lane_plan_cli.run(PLAN, directory)).toBe(SUCCESS)

		expect(info).not.toHaveBeenCalledWith('split')
		expect(lane_plan.read(LANE, directory)?.paths).toStrictEqual([FILE])
		expect(warnings()).toBe(1)
		expect(record_split_notice).not.toHaveBeenCalled()
	})

	it('does not answer `split` to `--probe`', async () => {
		expect(await lane_plan_cli.run([...PLAN, '--probe'], directory)).toBe(SUCCESS)
		expect(info).toHaveBeenCalledWith('clear')
	})

	it('still answers `split` when the mark names another issue', async () => {
		vi.stubEnv(lane_child_marker.KEY, String(OTHER))

		expect(await lane_plan_cli.run(PLAN, directory)).toBe(lane_plan_check.SPLIT_EXIT_CODE)
	})
})
