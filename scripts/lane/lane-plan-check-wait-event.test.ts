import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_common_directory } from '#scripts/git/git-common-directory'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { line_budget } from '#scripts/lines/line-budget'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan } from './lane-plan'
import { lane_plan_cli } from './lane-plan-cli'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_plan_wait } from './lane-plan-wait'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#6140: a lane's blocking `lane:plan` wait on a holder writes a `plan-wait` start and
// end around it, so `lane:breakdown` counts the wait as a row of its own.

const ROOT = make_directory('lane-plan-check-wait-event-')
const HOLDER = 5162
const LATER = 5171
const HELD = 'scripts/test/vitest-failure-summary.ts'
const WAIT_AHEAD_MS = 600_000
const LISTING_LIMIT = 100
const QUIET = {
	hunk_files: [],
	committed_files: [],
	lines_ratio: undefined,
	implement_rate: undefined,
	split_filed: false,
}
const directory = path.join(ROOT, 'lane')

function running(number: number): OpenIssueData {
	const labels = [{ name: 'in-progress' }, { name: 'auto-ok' }]

	return { number, title: 'running', createdAt: '2026-10-27T11:00:00Z', labels, body: '' }
}

const issues = [running(HOLDER), running(LATER)]

vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
	kind: 'read',
	issues,
	cutoff: cutoff_of(issues.length, LISTING_LIMIT, false),
})
vi.spyOn(line_budget, 'budgets_for').mockResolvedValue([])
vi.spyOn(lane_plan_signals, 'signals_of').mockResolvedValue(QUIET)
vi.spyOn(lane_ledger_write, 'record_split_notice').mockResolvedValue(undefined)
vi.spyOn(console, 'error').mockImplementation(vi.fn())
vi.spyOn(console, 'info').mockImplementation(vi.fn())
vi.spyOn(git_common_directory, 'repository').mockReturnValue(ROOT)
vi.spyOn(lane_plan_wait, 'deadline').mockResolvedValue(Date.now() + WAIT_AHEAD_MS)
vi.spyOn(lane_plan_wait, 'hold').mockResolvedValue('free')

const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)

describe('lane:plan bounded wait — the plan-wait events (#6140)', () => {
	it('writes a plan-wait start and end around the wait, naming the lane and the holder', async () => {
		lane_plan.record(
			{ issue: HOLDER, paths: [HELD], planned_at: '2000-01-01T00:00:00.000Z' },
			directory,
		)

		await lane_plan_cli.run([String(LATER), HELD], directory)

		expect(emit.mock.calls).toStrictEqual([
			[run_event_stream.EVENT_KIND.PLAN_WAIT, `#${String(LATER)} start #${String(HOLDER)}`],
			[run_event_stream.EVENT_KIND.PLAN_WAIT, `#${String(LATER)} end #${String(HOLDER)}`],
		])
	})
})
