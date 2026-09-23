import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { claude_agent_argv } from '#scripts/agent/claude-agent-argv'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { detached_launch, type LaunchRequest } from '#scripts/run/detached-launch'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { run_liveness } from '#scripts/run/run-liveness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_child_marker } from './lane-child-marker'
import { lane_dispatch, type DispatchOutcome } from './lane-dispatch'
import { lane_output } from './lane-output'
import { lane_registry, type LaneInfo } from './lane-registry'
import { openai_lane_supervisor } from './openai-lane-supervisor'

// **The launch and the lane lookup are spied on, not reimplemented.** What this file pins is the
// request the dispatch composes — which directory the child runs in, which file it writes to, and that
// the invocation is `fullrun #<N>` rather than anything a caller handed in. That the request then
// starts a real detached process is `run-wake-session.test.ts`'s, which spawns one
// (joshuafolkken/kit#1749).

const ISSUE = '1749'
const LANE_DIRECTORY = path.join(os.tmpdir(), 'josh-test-lanes', `${ISSUE}-lane`)
// What the older flow recorded in a lane: the unit's own transcript, a file to read rather than write.
const RECORDED_TRANSCRIPT = path.join(os.tmpdir(), 'josh-test-session.jsonl')
const ALIVE_PROCESS = '--process alive'
// An issue argument carrying a shell injection, refused by both invocation builders before it reaches a
// command line.
const INJECTION = '1749; rm -rf /'
const LAUNCH_FAILURE = 'spawn claude ENOENT'
const LOG_REFUSED = 'the session log at /x could not be opened'
const PID = 4242
const WORKER_PROFILE = agent_role_profile.DEFAULT_PROFILES.worker

const launch = vi.spyOn(detached_launch, 'launch')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const record_output = vi.spyOn(lane_output, 'record_output')
const add_label = vi.spyOn(git_gh_command, 'issue_add_label')
const remove_label = vi.spyOn(git_gh_command, 'issue_remove_label')
const check_diagnostics = vi.spyOn(agent_diagnostics, 'check')
const active_supervisor = vi.spyOn(openai_lane_supervisor, 'active')
const wait_for_supervisor = vi.spyOn(openai_lane_supervisor, 'wait_for_active')
const approve_supervisor = vi.spyOn(openai_lane_supervisor, 'approve')
const cancel_supervisor = vi.spyOn(openai_lane_supervisor, 'cancel')

// The launch record is `lane-dispatch-launch-event.test.ts`'s; here it stays off the real stream.
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue(undefined)

function lane(output: string | undefined): LaneInfo {
	return {
		issue: ISSUE,
		branch: `${ISSUE}-lane`,
		directory: LANE_DIRECTORY,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output,
		is_stranded: false,
	}
}

const DERIVED_LOG = lane_dispatch.default_log_path(lane(undefined))

function launched_request(): LaunchRequest {
	const request = launch.mock.calls[0]?.[0]
	if (request === undefined) throw new Error('Expected the child to be launched')

	return request
}

function mock_supervisor(): void {
	active_supervisor.mockReturnValue(undefined)
	wait_for_supervisor.mockResolvedValue(undefined)
	approve_supervisor.mockReturnValue(true)
	cancel_supervisor.mockReturnValue(true)
}

beforeEach(() => {
	vi.clearAllMocks()
	for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
	vi.stubEnv('CLAUDE_CODE_SESSION_ID', 'session')
	vi.stubEnv('CODEX_THREAD_ID', '')
	launch.mockReturnValue({ kind: 'launched', pid: PID })
	find_open_lane.mockResolvedValue(lane(undefined))
	record_output.mockResolvedValue({
		kind: 'recorded',
		lane: lane(DERIVED_LOG),
		output: DERIVED_LOG,
	})
	add_label.mockResolvedValue(true)
	remove_label.mockResolvedValue(undefined)
	mock_supervisor()
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('lane_dispatch.child_invocation — what the child is asked to do', () => {
	it('asks for `fullrun #<N>` and nothing else', () => {
		expect(lane_dispatch.child_invocation(ISSUE)).toBe(`fullrun #${ISSUE}`)
	})

	it('refuses anything that is not an issue number, before it reaches a command line', () => {
		expect(() => lane_dispatch.child_invocation(INJECTION)).toThrow()
		expect(() => lane_dispatch.child_invocation('')).toThrow()
	})
})

// joshuafolkken/kit#2022: a relaunched child is given a resume-specific prompt so it does not read the
// workflow-commands entry documents to learn it is a resume. This pins that instruction — its resume
// command, and that it still ends with `child_invocation` so the parent's liveness poll keeps matching.
describe('lane_dispatch.resume_invocation — what a relaunched child is asked to do', () => {
	it('tells the child to resume first and points it at the resume guide, not the entry docs', () => {
		const prompt = lane_dispatch.resume_invocation(ISSUE)

		expect(prompt).toContain(`pnpm josh run:cut --resume ${ISSUE}`)
		expect(prompt).toContain('pre-gate-cut.md')
		expect(prompt).toContain('do not re-read the workflow-commands entry documents')
	})

	// The parent's poll is `pgrep -laf "<child_invocation>$"` (see `describe`), so a relaunched process
	// whose command line did not end with `fullrun #<N>` would be booked stopped while it ran.
	it('ends with the bare `fullrun #<N>`, so the liveness poll keeps matching the relaunch', () => {
		expect(
			lane_dispatch.resume_invocation(ISSUE).endsWith(lane_dispatch.child_invocation(ISSUE)),
		).toBe(true)
	})

	it('is a safe single command-line argument, never one the launcher rejects', () => {
		const argv = claude_agent_argv.build(
			lane_dispatch.resume_invocation(ISSUE),
			agent_role_profile.DEFAULT_PROFILES.worker,
		)

		expect(detached_launch.is_safe_argv(argv)).toBe(true)
	})

	it('refuses anything that is not an issue number', () => {
		expect(() => lane_dispatch.resume_invocation(INJECTION)).toThrow()
		expect(() => lane_dispatch.resume_invocation('')).toThrow()
	})
})

describe('lane_dispatch.default_log_path — the log the dispatch owns', () => {
	it('is a path `run:liveness` can read, so the record is never one it refuses', () => {
		expect(run_liveness.to_safe_path(DERIVED_LOG)).toBeDefined()
	})

	it('is in the temp directory, so it survives `lane:close`', () => {
		expect(DERIVED_LOG.startsWith(PLATFORM_TEMP_ROOT)).toBe(true)
	})

	it('names the issue, so a person can find the file by eye', () => {
		expect(DERIVED_LOG).toContain(ISSUE)
	})

	it('differs between two lanes sharing an issue number across repositories', () => {
		const elsewhere = { ...lane(undefined), directory: `${LANE_DIRECTORY}-other-repository` }

		expect(lane_dispatch.default_log_path(elsewhere)).not.toBe(DERIVED_LOG)
	})
})

describe('lane_dispatch.dispatch_child — provider selection', () => {
	it('uses the OpenAI worker adapter when the provider is selected', async () => {
		for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
		vi.stubEnv('CODEX_THREAD_ID', 'thread')
		check_diagnostics.mockReturnValue({ kind: 'ready' })
		wait_for_supervisor.mockResolvedValue({ issue: ISSUE, nonce: 'owner', pid: PID })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		const request = launched_request()

		expect(outcome.kind).toBe('dispatched')
		expect(request.argv.command).toBe(process.execPath)
		expect(request.argv.args).toContain(ISSUE)
		expect(request.profile).toStrictEqual(agent_role_profile.OPENAI_PROFILES.worker)
	})

	it('does not reuse a live OpenAI owner recorded for another issue', async () => {
		for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
		vi.stubEnv('CODEX_THREAD_ID', 'thread')
		check_diagnostics.mockReturnValue({ kind: 'ready' })
		active_supervisor.mockReturnValue({ issue: '9999', nonce: 'other', pid: PID })
		wait_for_supervisor.mockResolvedValue({ issue: '9999', nonce: 'other', pid: PID })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(launch).toHaveBeenCalledOnce()
		expect(outcome.kind).toBe('failed')
		expect(remove_label).toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
	})

	it('reports failure when the spawned OpenAI supervisor never claims the lane', async () => {
		for (const key of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(key, '')
		vi.stubEnv('CODEX_THREAD_ID', 'thread')
		check_diagnostics.mockReturnValue({ kind: 'ready' })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('failed')
		expect(outcome.kind === 'failed' && outcome.note).toContain('did not claim')
		expect(cancel_supervisor).toHaveBeenCalledOnce()
		expect(remove_label).toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
	})
})

describe('lane_dispatch.dispatch_child — the request the lane gets', () => {
	it('starts the agent CLI headless in the lane’s own work tree, writing to its own log', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		const built = claude_agent_argv.build(
			`fullrun #${ISSUE}`,
			WORKER_PROFILE,
			undefined,
			LANE_DIRECTORY,
		)

		expect(launch.mock.calls[0]?.[0]).toStrictEqual({
			argv: built,
			cwd: LANE_DIRECTORY,
			log_path: DERIVED_LOG,
			profile: WORKER_PROFILE,
			env: { [lane_child_marker.KEY]: ISSUE },
		})
		expect(launched_request().profile).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
	})

	// **The mark is what tells the child it was dispatched rather than typed** (joshuafolkken/kit#1904),
	// so the pre-gate cut fires from the environment instead of the model's reading of its own prompt.
	it('marks the child as dispatched for this issue', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(launch.mock.calls[0]?.[0].env).toStrictEqual({ [lane_child_marker.KEY]: ISSUE })
	})

	it('records the path it writes to, so an unrecorded lane is not a reachable state', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(record_output).toHaveBeenCalledWith(ISSUE, DERIVED_LOG, WORKER_PROFILE)
		expect(outcome.kind === 'dispatched' && outcome.log_path).toBe(DERIVED_LOG)
	})

	it('never appends into a path the lane already recorded, which may be a transcript to read', async () => {
		find_open_lane.mockResolvedValue(lane(RECORDED_TRANSCRIPT))

		await lane_dispatch.dispatch_child(ISSUE)

		expect(record_output).toHaveBeenCalledWith(ISSUE, DERIVED_LOG, WORKER_PROFILE)
		expect(launch.mock.calls[0]?.[0].log_path).toBe(DERIVED_LOG)
	})
})

describe('lane_dispatch.dispatch_child — when it starts nothing', () => {
	it('starts nothing when no lane is open for the child', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await lane_dispatch.dispatch_child(ISSUE)).toStrictEqual({ kind: 'no-lane' })
		expect(launch).not.toHaveBeenCalled()
	})

	it('starts nothing when the path could not be recorded', async () => {
		record_output.mockResolvedValue({ kind: 'invalid', reason: 'the path cannot hold a quote' })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('unrecordable')
		expect(launch).not.toHaveBeenCalled()
	})

	it('reports a failed launch rather than leaving it silent', async () => {
		launch.mockReturnValue({ kind: 'failed', note: LAUNCH_FAILURE })

		const outcome = await lane_dispatch.dispatch_child(ISSUE)
		const message = lane_dispatch.describe(outcome, ISSUE)

		expect(outcome.kind).toBe('failed')
		expect(message).toContain(LAUNCH_FAILURE)
		expect(message).toContain(DERIVED_LOG)
	})
})

// The launcher starts the child anyway when it cannot open the log, discarding its output. Reported as
// a plain success, the operator polls a file that never grows and books a working child as stopped.
describe('lane_dispatch — a child that started with nowhere to write', () => {
	beforeEach(() => {
		launch.mockImplementation((_request, on_error) => {
			on_error(LOG_REFUSED)

			return { kind: 'launched', pid: PID }
		})
	})

	it('is still a dispatch, because the child really is running', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('dispatched')
		expect(outcome.kind === 'dispatched' && outcome.notes).toStrictEqual([LOG_REFUSED])
	})

	it('says the output is not being kept rather than naming a file that will not grow', async () => {
		const message = lane_dispatch.describe(await lane_dispatch.dispatch_child(ISSUE), ISSUE)

		expect(message).toContain('NOT being kept')
		expect(message).toContain(LOG_REFUSED)
	})

	it('is warned about, unlike an ordinary dispatch', async () => {
		expect(lane_dispatch.is_worth_warning(await lane_dispatch.dispatch_child(ISSUE))).toBe(true)
	})
})

describe('lane_dispatch.is_worth_warning — what nobody would otherwise hear about', () => {
	it('says nothing about a dispatch that went entirely to plan', async () => {
		expect(lane_dispatch.is_worth_warning(await lane_dispatch.dispatch_child(ISSUE))).toBe(false)
	})

	it('warns on every refusal', () => {
		expect(lane_dispatch.is_worth_warning({ kind: 'no-lane' })).toBe(true)
		expect(lane_dispatch.is_worth_warning({ kind: 'unrecordable', reason: 'x' })).toBe(true)
	})
})

// The parent claims `in-progress` at dispatch, so the window in which a running child looks like an
// empty lane closes here rather than tens of minutes later once the child's own fullrun applies it.
describe('lane_dispatch.dispatch_child — the in-progress marker the parent claims', () => {
	it('applies in-progress before it starts the child', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(add_label).toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
		expect(add_label.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
			launch.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('starts nothing when the marker could not be applied', async () => {
		add_label.mockResolvedValue(false)

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(outcome.kind).toBe('label-unset')
		expect(launch).not.toHaveBeenCalled()
	})

	it('warns rather than leaving an unapplied marker silent', async () => {
		add_label.mockResolvedValue(false)

		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(lane_dispatch.is_worth_warning(outcome)).toBe(true)
		expect(lane_dispatch.describe(outcome, ISSUE)).toContain(IN_PROGRESS_LABEL)
	})

	it('takes the marker back off when the launch fails, leaving none on an idle issue', async () => {
		launch.mockReturnValue({ kind: 'failed', note: LAUNCH_FAILURE })

		await lane_dispatch.dispatch_child(ISSUE)

		expect(remove_label).toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
	})

	it('leaves the marker in place on a dispatch that started the child', async () => {
		await lane_dispatch.dispatch_child(ISSUE)

		expect(remove_label).not.toHaveBeenCalled()
	})
})

describe('lane_dispatch.describe — what a reader is told to do next', () => {
	const no_lane: DispatchOutcome = { kind: 'no-lane' }

	it('names `lane:open` when there is no lane to dispatch into', () => {
		expect(lane_dispatch.describe(no_lane, ISSUE)).toContain(`pnpm josh lane:open ${ISSUE}`)
	})

	it('matches the child’s command line, not the lane directory its argv omits', async () => {
		const message = lane_dispatch.describe(await lane_dispatch.dispatch_child(ISSUE), ISSUE)

		expect(message).toContain(`pgrep -laf "${lane_child_invocation.process_pattern(ISSUE)}"`)
		expect(message).not.toContain(`pgrep -laf ${LANE_DIRECTORY}`)
		expect(message).toContain(ALIVE_PROCESS)
	})

	it('never throws, so a warning cannot lose the message it exists to carry', async () => {
		const outcome = await lane_dispatch.dispatch_child(ISSUE)

		expect(() => lane_dispatch.describe(outcome, 'not-a-number')).not.toThrow()
	})
})
