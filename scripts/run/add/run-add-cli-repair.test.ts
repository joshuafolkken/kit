import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table } from '#scripts/lane/lane-process-table'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_adoption } from '#scripts/run/cut/run-cut-adoption'
import { run_cut_cli } from '#scripts/run/cut/run-cut-cli'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_pr_return } from '#scripts/run/run-pr-return'
import { run_stage } from '#scripts/run/run-stage'
import { run_stage_read } from '#scripts/run/run-stage-read'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { describe, expect, it, vi } from 'vitest'
import { run_add_cli } from './run-add-cli'
import { run_add_cli_repair_fixture } from './run-add-cli-repair-fixture'

const { ISSUE, target } = run_cut_cli_fixture
const { COMMENT, PORTS, REQUESTED_AT, REVIEWED_AT, state } = run_add_cli_repair_fixture
const MISSING_ADOPTION = 'Missing fixture adoption'

run_add_cli_repair_fixture.install(run_cut_cli.run)

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
