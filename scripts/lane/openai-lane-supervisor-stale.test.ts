import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { run_cut_resume } from '#scripts/run/cut/run-cut-resume'
import { detached_launch } from '#scripts/run/detached-launch'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { lane_session_broker } from './lane-session-broker'
import { openai_lane_ship } from './openai-lane-ship'
import { openai_lane_supervisor } from './openai-lane-supervisor'
import { openai_lane_supervisor_owner } from './openai-lane-supervisor-owner'

const make_directory = temporary_directory('suite')
const directory = make_directory('supervisor-stale-')
const target = run_cut.cut_path(directory)
const work = path.join(directory, 'uncommitted.txt')
const ISSUE = '7405'
const BRANCH = '7405-lane'
const CHILD_PID = 8123
const INTERRUPTED = 'interrupted'
const INTERRUPTION = 'supervisor interrupted'
const OTHER_BRANCH = 'different-lane'
const DIRTY_WORK = 'work to preserve'
const profile = agent_role_profile.OPENAI_PROFILES.worker
const lane: LaneInfo = {
	issue: ISSUE,
	branch: BRANCH,
	directory,
	seat: undefined,
	development_port: undefined,
	preview_port: undefined,
	output: undefined,
	is_stranded: false,
	profile,
}
const launch = vi.spyOn(detached_launch, 'launch_attached')
const notifications = vi.fn()
const error = vi.spyOn(console, 'error')
const original_is_same_process = process_identity.is_same_process

function cut(): void {
	run_cut.begin_cut(target, { issue: ISSUE, branch: BRANCH, phase: run_cut.PRE_GATE_PHASE })
}

async function stale_child(): Promise<{ kind: 'completed'; pid: number; exit_code: number }> {
	// Exercise the real resume refusal; the notification sink never sends Telegram.
	const exit_code = await run_cut_resume.resume(target, ISSUE)

	notifications()

	return { kind: 'completed', pid: CHILD_PID, exit_code }
}

async function finish_child(): Promise<{ kind: 'completed'; pid: number; exit_code: number }> {
	// Bound the broken implementation so a regression fails without looping forever.
	run_cut.end_cut(target)

	return { kind: 'completed', pid: CHILD_PID, exit_code: 0 }
}

async function supervise(nonce: string): Promise<number> {
	openai_lane_supervisor.approve(directory, nonce)

	return await openai_lane_supervisor.supervise(lane, profile, nonce)
}

async function interrupt_supervisor(): Promise<void> {
	let saved: ReturnType<typeof openai_lane_supervisor_owner.read_state>

	launch.mockImplementationOnce(async (_request, _log, on_started) => {
		on_started?.(CHILD_PID)
		saved = openai_lane_supervisor_owner.read_state(directory, INTERRUPTED)
		throw new Error(INTERRUPTION)
	})
	await expect(supervise(INTERRUPTED)).rejects.toThrow(INTERRUPTION)
	stamp_file.write_stamp(openai_lane_supervisor.marker_path(directory), {
		issue: ISSUE,
		nonce: INTERRUPTED,
		pid: 999_999,
		process_start: 'dead',
	})
	stamp_file.write_stamp(openai_lane_supervisor.state_path(directory), saved)
}

function reset_environment(): void {
	vi.spyOn(run_cut, 'worktree_directory').mockResolvedValue(directory)
	vi.spyOn(run_cut, 'current_state').mockResolvedValue({
		branch: OTHER_BRANCH,
		is_dirty: true,
		is_held: true,
	})
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)
	vi.spyOn(openai_lane_ship, 'current').mockResolvedValue(undefined)
	vi.spyOn(openai_lane_ship, 'wait_for_ship').mockResolvedValue('none')
	vi.spyOn(lane_session_broker, 'with_server').mockImplementation(async (_lane, run) => await run())
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

beforeEach(() => {
	run_cut.end_cut(target)
	stamp_file.remove_stamp(openai_lane_supervisor.marker_path(directory))
	stamp_file.remove_stamp(openai_lane_supervisor.state_path(directory))
	writeFileSync(work, DIRTY_WORK)
	reset_environment()
	vi.spyOn(process_identity, 'is_same_process').mockImplementation(original_is_same_process)
	error.mockImplementation(() => undefined)
	launch.mockImplementation(finish_child)
})

afterAll(() => vi.restoreAllMocks())

async function expect_preserved(before: string): Promise<void> {
	expect(readFileSync(target, 'utf8')).toBe(before)
	expect(readFileSync(work, 'utf8')).toBe(DIRTY_WORK)
	expect(await run_cut.current_state()).toMatchObject({ branch: OTHER_BRANCH, is_dirty: true })
}

function inherit_child(): void {
	let checks = 0

	vi.spyOn(process_identity, 'is_same_process').mockImplementation((pid, start) => {
		if (pid !== CHILD_PID) return original_is_same_process(pid, start)

		checks += 1

		return checks === 1
	})
}

describe('a stale cut under the OpenAI supervisor', () => {
	it('does not restart an unchanged cut even when the refusing child exits successfully', async () => {
		cut()
		launch.mockImplementationOnce(async () => {
			await stale_child()

			return { kind: 'completed', pid: CHILD_PID, exit_code: 0 }
		})

		expect(await supervise('successful-exit')).toBe(1)
		expect(launch).toHaveBeenCalledTimes(1)
		expect(notifications).toHaveBeenCalledTimes(1)
	})

	it('stops a stale successor after an ordinary child hands off a new cut', async () => {
		launch
			.mockImplementationOnce(async () => {
				cut()

				return { kind: 'completed', pid: CHILD_PID, exit_code: 0 }
			})
			.mockImplementationOnce(stale_child)

		expect(await supervise('fresh-then-stale')).toBe(1)
		expect(launch).toHaveBeenCalledTimes(2)
		expect(notifications).toHaveBeenCalledTimes(1)
		expect(run_cut.read_cut(target).kind).toBe('carried')
	})
})

describe('stale cut preservation and recovery', () => {
	it('stops after one stale refusal and notification, preserving work and the cut', async () => {
		cut()
		const before = readFileSync(target, 'utf8')

		launch.mockImplementationOnce(stale_child)

		expect(await supervise('stale')).toBe(1)
		expect(launch).toHaveBeenCalledTimes(1)
		expect(notifications).toHaveBeenCalledTimes(1)
		expect(run_cut_report.last_verdict()).toBe('stale')
		await expect_preserved(before)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('resume did not adopt cut'))
	})

	it('stops a recovered supervisor after the inherited stale child exits', async () => {
		cut()
		const before = readFileSync(target, 'utf8')

		await interrupt_supervisor()
		inherit_child()
		await stale_child()

		expect(await supervise('recovered')).toBe(1)
		expect(launch).toHaveBeenCalledTimes(1)
		expect(notifications).toHaveBeenCalledTimes(1)
		expect(readFileSync(target, 'utf8')).toBe(before)
	})
})

describe('recovery across cut identities', () => {
	it('remembers the resume attempt when recovery finds the inherited child already dead', async () => {
		cut()
		await interrupt_supervisor()

		expect(await supervise('dead-child')).toBe(1)
		expect(launch).toHaveBeenCalledTimes(1)
		expect(notifications).not.toHaveBeenCalled()
		expect(run_cut.read_cut(target).kind).toBe('carried')
	})

	it('continues a new cut handed off by an inherited child', async () => {
		cut()
		await interrupt_supervisor()
		inherit_child()
		run_cut.end_cut(target)
		run_cut.begin_cut(
			target,
			{
				issue: ISSUE,
				branch: BRANCH,
				phase: run_cut.PRE_GATE_PHASE,
			},
			new Date(Date.now() + 1),
		)

		expect(await supervise('new-cut')).toBe(0)
		expect(launch).toHaveBeenCalledTimes(2)
		expect(launch.mock.calls.at(-1)?.[0].argv.args.at(-1)).toContain(`run:entry ${ISSUE}`)
	})
})
