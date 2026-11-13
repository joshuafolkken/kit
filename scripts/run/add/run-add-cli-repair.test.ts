import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_spent } from '#scripts/lane/lane-spent'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_adoption } from '#scripts/run/cut/run-cut-adoption'
import { run_cut_cli } from '#scripts/run/cut/run-cut-cli'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_open_pr } from '#scripts/run/run-open-pr'
import { run_pr_return } from '#scripts/run/run-pr-return'
import { run_prrun_resume } from '#scripts/run/run-prrun-resume'
import { run_stage } from '#scripts/run/run-stage'
import { run_stage_read } from '#scripts/run/run-stage-read'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddPorts } from './run-add'
import { run_add_cli } from './run-add-cli'

const { ISSUE, existing_cut, lane, target } = run_cut_cli_fixture
const CUT_TARGET = target()
const make_directory = temporary_directory('suite')
const LABELS = ['run:stalled']
const PORTS: AddPorts = {
	read_issue: async () => ({ is_open: true, labels: LABELS, blockers: [] }),
	apply_label: async () => true,
	clear_label: async () => true,
}
const REVIEWED_AT = '2026-11-12T01:00:00Z'
const REQUESTED_AT = '2026-11-12T02:00:00Z'
const MISSING_ADOPTION = 'Missing fixture adoption'
const COMMENT = {
	id: 7477,
	author: 'joshuafolkken',
	is_trusted: true,
	is_automated: false,
	created_at: REQUESTED_AT,
	body: 'Please fix the review findings.',
}
const state = { stream: '', directory: '' }

run_cut_cli_fixture.install()

afterEach(() => {
	if (vi.isMockFunction(run_event_stream_emit.append_at)) {
		run_event_stream_emit.append_at.mockRestore()
	}
})

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
	vi.spyOn(git_common_directory, 'own').mockReturnValue(directory)
	vi.spyOn(run_cut, 'cut_path').mockReturnValue(CUT_TARGET)
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

beforeEach(async () => {
	const directory = make_directory('repair-attempt-')

	setup_stream(directory)
	setup_lane(directory)
	setup_pr()
	existing_cut()
	await run_cut_cli.run(['--resume', ISSUE])

	for (const kind of ['human-review', 'child-launch', 'park']) {
		run_event_stream.append(state.stream, kind, `#${ISSUE} stale hand-off`, REVIEWED_AT)
	}
})

describe('reviewed pull request repair through the resume CLI', () => {
	it('resumes an ended adopted cut directly through the entry resume seam', async () => {
		await run_cut_cli.run(['--resume', ISSUE])
		expect(run_cut_cli_fixture.verdict()).toBe('fresh')
		expect(run_cut.read_cut(target()).kind).toBe('none')
		const stage = await run_stage_read.read_stage(ISSUE)

		expect(stage.state).toBe('pr-returned')
	})

	it('queues a fresh repair once and reaches implementation without the old adoption', async () => {
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(0)
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(0)
		const events = run_event_stream.read_events(state.stream)

		expect(events.filter((event) => event.text.startsWith(`retry #${ISSUE}`))).toHaveLength(1)
		expect(run_cut.read_cut(target()).kind).toBe('none')
		await run_cut_cli.run(['--resume', ISSUE])
		expect(run_cut_cli_fixture.verdict()).toBe('fresh')
		const stage = await run_stage_read.read_stage(ISSUE)

		expect(run_stage.decide(stage.state, 'fullrun').start).toBe('implement')
	})

	it.each(['alive', 'unknown'] as const)(
		'preserves the adoption with a %s owner',
		async (trace) => {
			vi.mocked(lane_await.other_process_trace).mockResolvedValue(trace)
			expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
			await run_cut_cli.run(['--resume', ISSUE])
			expect(run_cut_cli_fixture.verdict()).toBe('handed-off')
			expect(run_cut.read_cut(target()).kind).toBe('carried')
		},
	)
})

describe('repair refusal and durable writes', () => {
	it.each(['merge', 'withdraw', 'split'])('preserves a previous %s', async (kind) => {
		run_event_stream.append(state.stream, kind, `#${ISSUE} settled`, REQUESTED_AT)
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})

	it.each(['needs-human-review', 'needs-decision'])('preserves unanswered %s', async (label) => {
		vi.mocked(issue_state_cli.read_issue).mockResolvedValue({
			kind: 'state',
			state: {
				state: 'OPEN',
				labels: [label],
				is_human_review: true,
			},
		})
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})

	it.each([false, undefined])(
		'refuses an untrusted or unknown request (%s)',
		async (is_trusted) => {
			vi.mocked(run_pr_return.read).mockResolvedValue({
				red_checks: [],
				comments: [{ ...COMMENT, is_trusted }],
			})
			expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
			expect(run_cut.read_cut(target()).kind).toBe('carried')
		},
	)
})

describe('repair request ordering and write failures', () => {
	it('refuses a request predating the human review stop', async () => {
		vi.mocked(run_pr_return.read).mockResolvedValue({
			red_checks: [],
			comments: [{ ...COMMENT, created_at: REVIEWED_AT }],
		})
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
	})

	it('refuses a PR that has merged', async () => {
		vi.mocked(git_gh_command.pr_view).mockResolvedValue(JSON.stringify({ state: 'MERGED' }))
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
	})

	it('does not report queued or release the cut when the boundary write fails', async () => {
		vi.spyOn(run_event_stream_emit, 'append_at').mockResolvedValue({ appended: false, position: 0 })
		vi.mocked(console.info).mockClear()
		await expect(run_add_cli.run([ISSUE, '--retry'], PORTS)).rejects.toThrow(
			'repair attempt boundary',
		)
		expect(console.info).not.toHaveBeenCalled()
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})
})

describe('repair ownership records', () => {
	it('preserves an unreadable cut', async () => {
		stamp_file.write_text_stamp(target(), 'broken')
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
		expect(run_cut.read_cut(target()).kind).toBe('unreadable')
	})

	it('preserves an unreadable ship owner', async () => {
		stamp_file.write_text_stamp(run_ship_detach.result_path(state.directory, ISSUE), 'broken')
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})

	it('preserves a live ship even after its worker ended', async () => {
		stamp_file.replace_stamp(run_ship_detach.result_path(state.directory, ISSUE), {
			launch_id: 'repair-ship',
			pid: process.pid,
			launched_at: Date.now(),
		})
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(1)
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})

	it('refuses a repeated request when its queued ownership becomes unreadable', async () => {
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(0)
		stamp_file.write_text_stamp(run_ship_detach.result_path(state.directory, ISSUE), 'broken')
		await expect(run_add_cli.run([ISSUE, '--retry'], PORTS)).rejects.toThrow('safely resume')
	})
})

describe('repair history beyond the active invocation', () => {
	it('reaches implementation when the replacement worker itself matches the live probe', async () => {
		vi.spyOn(lane_await, 'process_trace_default').mockReturnValue('alive')
		vi.mocked(lane_await.other_process_trace).mockRestore()
		vi.spyOn(lane_process_table, 'read_table').mockResolvedValue(
			lane_process_table.parse(
				`${String(process.pid)} 1 00:00 0 S Fri Nov 13 00:00:00 2026 agent fullrun #${ISSUE}`,
			),
		)
		await run_cut_cli.run(['--resume', ISSUE])
		expect(run_cut_cli_fixture.verdict()).toBe('fresh')
		expect(run_cut.read_cut(target()).kind).toBe('none')
		const stage = await run_stage_read.read_stage(ISSUE)

		expect(run_stage.decide(stage.state, 'fullrun').start).toBe('implement')
	})

	it('repairs an adoption released by human-review collection before direct entry', async () => {
		const read = run_cut.read_cut(target())

		if (read.kind !== 'carried') throw new Error(MISSING_ADOPTION)
		run_cut_adoption.release(target(), read.cut, ISSUE)
		await run_cut_cli.run(['--resume', ISSUE])
		expect(run_cut_cli_fixture.verdict()).toBe('fresh')
		expect(run_cut.read_cut(target()).kind).toBe('none')
		const stage = await run_stage_read.read_stage(ISSUE)

		expect(run_stage.decide(stage.state, 'fullrun').start).toBe('implement')
	})
})

describe('repair history across carries and expiration', () => {
	it('reads the real issue history even when its review predates the new carry', async () => {
		vi.mocked(run_event_stream_emit.all_events).mockRestore()
		expect(await run_add_cli.run([ISSUE, '--retry'], PORTS)).toBe(0)
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	it('ends an expired adopted cut for a verified repair instead of resuming stale work', async () => {
		const read = run_cut.read_cut(target())

		if (read.kind !== 'carried') throw new Error(MISSING_ADOPTION)
		stamp_file.replace_stamp(target(), { ...read.cut, cut_at: REVIEWED_AT })
		await run_cut_cli.run(['--resume', ISSUE])
		expect(run_cut_cli_fixture.verdict()).toBe('fresh')
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})
})
