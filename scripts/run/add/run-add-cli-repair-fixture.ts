import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_open_pr } from '#scripts/run/run-open-pr'
import { run_pr_return } from '#scripts/run/run-pr-return'
import { run_prrun_resume } from '#scripts/run/run-prrun-resume'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, vi } from 'vitest'
import type { AddPorts } from './run-add'

// A reviewed pull request whose lane ended, adopted by a `--resume` cut: the state a repair attempt
// starts from, shared by the suites that drive `run:add --retry` over it.

type Resume = (argv: ReadonlyArray<string>) => Promise<number>

const { ISSUE, existing_cut, lane, target } = run_cut_cli_fixture
const make_directory = temporary_directory('suite')
const LABELS = ['run:stalled']
const PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, labels: LABELS, blockers: [] }),
	apply_label: async () => true,
	clear_label: async () => true,
}
const REVIEWED_AT = '2026-11-12T01:00:00Z'
const REQUESTED_AT = '2026-11-12T02:00:00Z'
const COMMENT = {
	id: 7477,
	author: 'joshuafolkken',
	is_trusted: true,
	is_automated: false,
	created_at: REQUESTED_AT,
	body: 'Please fix the review findings.',
}
const state = { stream: '', directory: '' }

function setup_stream(directory: string): void {
	state.directory = directory
	state.stream = run_event_stream.target_of(directory)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(directory)
	run_carry.end_carry(run_carry.carry_path(directory))
	run_carry.begin_carry(
		run_carry.carry_path(directory),
		`backlogrun #${ISSUE}`,
		run_carry.NO_OWNER,
		new Date(),
	)
	vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(state.stream)
	vi.spyOn(run_event_stream_emit, 'current_events').mockImplementation(async () =>
		run_event_stream.read_events(state.stream),
	)
	vi.spyOn(run_event_stream_emit, 'all_events').mockImplementation(async () =>
		run_event_stream.read_events(state.stream),
	)
}

function setup_lane(directory: string): void {
	vi.spyOn(lane_spent, 'lanes_in_use').mockResolvedValue({ working: [], unread: [] })
	vi.spyOn(lane_await, 'other_process_trace').mockResolvedValue('none')
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue(lane())
	vi.spyOn(git_command, 'status').mockResolvedValue('')
	vi.spyOn(git_common_directory, 'own').mockReturnValue(directory)
	vi.spyOn(run_cut, 'cut_path').mockReturnValue(target())
}

function setup_pr(): void {
	vi.spyOn(run_open_pr, 'is_pending').mockResolvedValue(true)
	vi.spyOn(run_halfrun_resume, 'is_pending').mockResolvedValue(false)
	vi.spyOn(run_prrun_resume, 'resume_token').mockResolvedValue(undefined)
	vi.spyOn(backlog_plan_comment, 'read_plan').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: LABELS, is_human_review: false },
	})
	vi.spyOn(git_gh_command, 'pr_view').mockResolvedValue(JSON.stringify({ state: 'OPEN' }))
	vi.spyOn(run_pr_return, 'read').mockResolvedValue({ red_checks: [], comments: [COMMENT] })
}

async function setup(resume: Resume): Promise<void> {
	const directory = make_directory('repair-attempt-')

	setup_stream(directory)
	setup_lane(directory)
	setup_pr()
	existing_cut()
	await resume(['--resume', ISSUE])

	for (const kind of ['human-review', 'child-launch', 'park']) {
		run_event_stream.append(state.stream, kind, `#${ISSUE} stale hand-off`, REVIEWED_AT)
	}
}

function restore_append(): void {
	if (vi.isMockFunction(run_event_stream_emit.append_at)) {
		run_event_stream_emit.append_at.mockRestore()
	}
}

// `resume` is `run_cut_cli.run`, handed in by the suite: a module with a main guard is imported by
// test files only (`main-guard-boundary.test.ts`).
function install(resume: Resume): void {
	run_cut_cli_fixture.install()
	afterEach(restore_append)
	beforeEach(async () => {
		await setup(resume)
	})
}

const run_add_cli_repair_fixture = {
	COMMENT,
	PORTS,
	REQUESTED_AT,
	REVIEWED_AT,
	install,
	state,
}

export { run_add_cli_repair_fixture }
