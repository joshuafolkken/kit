import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { detached_launch, type LaunchRequest } from '#scripts/run/detached-launch'
import { run_cut } from '#scripts/run/run-cut'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LaneInfo } from './lane-registry'
import { openai_lane_supervisor } from './openai-lane-supervisor'

const ISSUE = '2084'
const BRANCH = '2084-lane'
const scratch = mkdtempSync(path.join(os.tmpdir(), 'openai-supervisor-test-'))
const repository = path.join(scratch, 'repository.git')
const lane_directory = path.join(scratch, 'lane')
const target = run_cut.cut_path(repository)
const profile = agent_role_profile.OPENAI_PROFILES.worker
const RESUME_PROMPT = 'run:cut --resume 2084'
const EPHEMERAL_FLAG = '--ephemeral'

const launch = vi.spyOn(detached_launch, 'launch_attached')
const worktree = vi.spyOn(run_cut, 'worktree_directory')
const diagnostic = vi.spyOn(agent_diagnostics, 'check')
const resolve_common_directory = vi.spyOn(git_common_directory, 'resolve')
const common_directory = path.join(scratch, 'repository with spaces', '.git')

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: BRANCH,
		directory: lane_directory,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
		profile,
	}
}

function cut(phase: string = run_cut.PRE_GATE_PHASE): void {
	run_cut.end_cut(target)
	run_cut.begin_cut(target, { issue: ISSUE, branch: BRANCH, phase })
}

function launched_request(index = 0): LaunchRequest {
	const request = launch.mock.calls[index]?.[0]
	if (request === undefined) throw new Error('expected a child launch')

	return request
}

async function supervise(nonce: string): Promise<number> {
	openai_lane_supervisor.approve(lane_directory, nonce)

	return await openai_lane_supervisor.supervise(lane(), profile, nonce)
}

beforeEach(() => {
	vi.clearAllMocks()
	run_cut.end_cut(target)
	stamp_file.remove_stamp(openai_lane_supervisor.marker_path(lane_directory))
	stamp_file.remove_stamp(openai_lane_supervisor.state_path(lane_directory))
	worktree.mockResolvedValue(repository)
	diagnostic.mockReturnValue({ kind: 'ready' })
	resolve_common_directory.mockReturnValue(undefined)
	launch.mockResolvedValue({ kind: 'completed', pid: 9001, exit_code: 0 })
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
})

describe('OpenAI lane supervisor generations', () => {
	it('launches an ordinary initial generation through the lane-local adapter', async () => {
		expect(await supervise('initial')).toBe(0)

		const request = launched_request()

		expect(request.argv.command).toBe('codex')
		expect(request.argv.args.at(-1)).toBe(`fullrun #${ISSUE}`)
		expect(request.argv.args).not.toContain(EPHEMERAL_FLAG)
		expect(request.argv.args).toContain(
			`sqlite_home=${JSON.stringify(path.join(lane_directory, 'node_modules/.cache/josh/openai'))}`,
		)
		expect(request.cwd).toBe(lane_directory)
	})

	it('rebuilds one successor per fresh handed-off cut across generations', async () => {
		launch
			.mockImplementationOnce(async () => {
				cut(run_cut.IMPLEMENTATION_PHASE)

				return { kind: 'completed', pid: 9001, exit_code: 0 }
			})
			.mockImplementationOnce(async () => {
				cut(run_cut.PRE_GATE_PHASE)

				return { kind: 'completed', pid: 9002, exit_code: 0 }
			})
			.mockImplementationOnce(async () => {
				run_cut.end_cut(target)

				return { kind: 'completed', pid: 9003, exit_code: 0 }
			})

		expect(await supervise('generations')).toBe(0)
		expect(launch).toHaveBeenCalledTimes(3)
		expect(launched_request(1).argv.args.at(-1)).toContain(RESUME_PROMPT)
		expect(launched_request(1).argv.args).not.toContain(EPHEMERAL_FLAG)
		expect(launched_request(1).profile).toStrictEqual(profile)
		expect(launched_request(2).argv.args.at(-1)).toContain(RESUME_PROMPT)
	})
})

describe('OpenAI lane supervisor Git access', () => {
	it('allows the linked worktree Git common directory in the launched generation', async () => {
		resolve_common_directory.mockReturnValue(common_directory)

		await supervise('git-common-directory')

		const { args } = launched_request().argv
		const flag_index = args.indexOf('--add-dir')

		expect(resolve_common_directory).toHaveBeenCalledWith(lane_directory)
		expect(args.at(flag_index + 1)).toBe(common_directory)
		expect(args.lastIndexOf('--add-dir')).toBe(flag_index)
	})
})

describe('OpenAI lane supervisor recovery', () => {
	it('resumes a standing handoff before launching an ordinary initial generation', async () => {
		cut()
		launch.mockImplementationOnce(async () => {
			run_cut.end_cut(target)

			return { kind: 'completed', pid: 9001, exit_code: 0 }
		})

		await supervise('recovery')

		expect(launched_request().argv.args.at(-1)).toContain(RESUME_PROMPT)
	})

	it('leaves a standing cut intact when successor spawn fails', async () => {
		cut()
		launch.mockResolvedValue({ kind: 'failed', note: 'spawn refused' })

		expect(await supervise('failure')).toBe(1)
		expect(run_cut.read_cut(target).kind).toBe('carried')
	})
})

describe('OpenAI lane supervisor child completion', () => {
	it('reports a nonzero child exit instead of silently completing the supervisor', async () => {
		launch.mockResolvedValue({ kind: 'completed', pid: 9001, exit_code: 7 })
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await supervise('abnormal')).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('exited abnormally (7)'))
		error.mockRestore()
	})

	it('continues a valid handoff even when the cutting child exits nonzero', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		launch
			.mockImplementationOnce(async () => {
				cut()

				return { kind: 'completed', pid: 9001, exit_code: 7 }
			})
			.mockImplementationOnce(async () => {
				run_cut.end_cut(target)

				return { kind: 'completed', pid: 9002, exit_code: 0 }
			})

		expect(await supervise('cut-abnormal')).toBe(0)
		expect(launch).toHaveBeenCalledTimes(2)
		expect(launched_request(1).argv.args.at(-1)).toContain(RESUME_PROMPT)
		error.mockRestore()
	})
})

describe('OpenAI supervisor ownership', () => {
	it('lets only one live supervisor own a lane', () => {
		const first = openai_lane_supervisor.claim(ISSUE, lane_directory, 'first')

		expect(first).toBeDefined()
		expect(openai_lane_supervisor.claim(ISSUE, lane_directory, 'second')).toBeUndefined()
		openai_lane_supervisor.release(lane_directory, 'first')
	})

	it('takes over a malformed marker without treating it as live', () => {
		stamp_file.write_text_stamp(openai_lane_supervisor.marker_path(lane_directory), 'not json')

		expect(openai_lane_supervisor.claim(ISSUE, lane_directory, 'replacement')).toBeDefined()
		openai_lane_supervisor.release(lane_directory, 'replacement')
	})
})

describe('OpenAI supervisor dispatch handshake', () => {
	it('does not start a child after dispatch cancellation wins', async () => {
		openai_lane_supervisor.cancel(lane_directory, 'cancelled')

		expect(await openai_lane_supervisor.supervise(lane(), profile, 'cancelled')).toBe(0)
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('OpenAI supervisor inherited-child recovery', () => {
	it('waits for an inherited child and exits without starting another ordinary run', async () => {
		stamp_file.write_stamp(openai_lane_supervisor.marker_path(lane_directory), {
			issue: ISSUE,
			nonce: 'dead',
			pid: 999_999,
			process_start: 'dead',
		})
		stamp_file.write_stamp(openai_lane_supervisor.state_path(lane_directory), {
			owner_nonce: 'dead',
			child_pid: 8123,
			child_process_start: 'child-start',
			epoch: 1,
		})
		const original = process_identity.is_same_process
		let child_checks = 0
		const live = vi.spyOn(process_identity, 'is_same_process')

		live.mockImplementation((pid, process_start) => {
			if (pid !== 8123) return original(pid, process_start)

			child_checks += 1

			return child_checks === 1
		})

		expect(await supervise('takeover')).toBe(0)
		expect(launch).not.toHaveBeenCalled()
		live.mockRestore()
	})
})

describe('OpenAI supervisor inherited-child identity', () => {
	it('does not inherit a reused child pid with a different process start', async () => {
		stamp_file.write_stamp(openai_lane_supervisor.marker_path(lane_directory), {
			issue: ISSUE,
			nonce: 'dead',
			pid: 999_999,
			process_start: 'dead',
		})
		stamp_file.write_stamp(openai_lane_supervisor.state_path(lane_directory), {
			owner_nonce: 'dead',
			child_pid: 8123,
			child_process_start: 'old-child',
			epoch: 1,
		})
		const original = process_identity.is_same_process
		const live = vi.spyOn(process_identity, 'is_same_process')

		live.mockImplementation((pid, process_start) =>
			pid === 8123 ? false : original(pid, process_start),
		)

		expect(await supervise('reused-pid')).toBe(0)
		expect(launch).toHaveBeenCalledOnce()
		expect(launched_request().argv.args.at(-1)).toBe(`fullrun #${ISSUE}`)
		live.mockRestore()
	})
})
