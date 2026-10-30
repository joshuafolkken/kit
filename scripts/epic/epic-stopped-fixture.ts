import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state, type LaneState, type LaneStateRecord } from '#scripts/lane/lane-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { vi } from 'vitest'
import type { EpicSnapshot } from './epic-fetch'
import { epic_label_age } from './epic-label-age'
import { epic_next_read } from './epic-next-read'

const REPO = 'joshuafolkken/kit'
const EPIC = '858'
const RUNNING = '700'
const STOPPED = '701'
const CHILD = '861'
const LIMIT = 2
const PID = 70_001
const START = 'Tue Oct 20 08:39:04 2026'

function lane(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: issue === RUNNING ? 1 : LIMIT,
		seat_held: issue === RUNNING,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

function record(issue: string, state: LaneState = 'running'): LaneStateRecord {
	return { issue, state, changed_at: '2026-10-20T01:28:00.000Z', changed_by: 'lane:run' }
}

function records(): Map<string, LaneStateRecord> {
	return new Map([RUNNING, STOPPED].map((issue) => [issue, record(issue)]))
}

function arrange_local(): void {
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([lane(RUNNING), lane(STOPPED)])
	vi.spyOn(lane_state, 'read_states').mockResolvedValue(records())
	vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(
		lane_process_table.parse(`${String(PID)} 1 0:00.01 4 S ${START} claude -p fullrun #${RUNNING}`),
	)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue('/repo/.git')
	vi.spyOn(run_ship_detach, 'read_result').mockReturnValue(undefined)
}

function arrange_remote(): void {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(
		listing_of(
			[RUNNING, STOPPED].map((issue) =>
				auto_ok_fixture.issue(Number(issue), CREATED_EARLIER, [IN_PROGRESS_LABEL]),
			),
		),
	)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	vi.spyOn(epic_label_age, 'read_ages').mockResolvedValue(new Map())
	vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: LIMIT })
}

function snapshot(): EpicSnapshot {
	return {
		body: undefined,
		repo: REPO,
		current_repo: REPO,
		children: [
			{
				number: Number(CHILD),
				repo: REPO,
				state: 'OPEN',
				labels: [RUN_LANE_LABEL],
				blocked_by: [],
			},
		],
		child_numbers: [Number(CHILD)],
		unreadable: [],
		skipped: [],
		has_external_children: false,
		body_failure: undefined,
		is_unreachable: false,
	}
}

function arrange_epic(): void {
	vi.spyOn(epic_next_read, 'read_snapshots').mockResolvedValue({
		notices: [],
		reads: [{ reference: { number: Number(EPIC) }, snapshot: snapshot() }],
	})
}

function arrange(): void {
	arrange_local()
	arrange_remote()
	arrange_epic()
}

const epic_stopped_fixture = {
	REPO,
	EPIC,
	RUNNING,
	STOPPED,
	CHILD,
	LIMIT,
	lane,
	record,
	records,
	snapshot,
	arrange,
}

export { epic_stopped_fixture }
