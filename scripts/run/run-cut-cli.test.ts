import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_dispatch } from '#scripts/lane/lane-dispatch'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { detached_launch } from './detached-launch'
import { run_cut, type CutState } from './run-cut'
import { run_cut_cli } from './run-cut-cli'

// joshuafolkken/kit#1839: these drive `josh run:cut` end to end with the git and lane reads spied, so
// what runs for real is the record logic and the branch each verdict takes — the cut relaunches once,
// a double cut is refused, a matching tree resumes, and a relaunch failure clears the record so the
// current process is never stranded.

const TEST_PREFIX = 'run-cut-cli-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const REPOSITORY = path.join(scratch, 'repository.git')

const ISSUE = '1839'
const BRANCH = '1839-lane'
const INVOCATION = 'fullrun #1839'
const DEFAULT_BRANCH = 'main'
const LANE_DIRECTORY = '/lanes/1839'
const DERIVED_LOG = path.join(scratch, 'lane-1839.log')
const LAUNCHED_PID = 4242
const READY: CutState = { branch: BRANCH, is_dirty: true, is_held: true }

function target(): string {
	return run_cut.cut_path(REPOSITORY)
}

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: BRANCH,
		directory: LANE_DIRECTORY,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const worktree = vi.spyOn(run_cut, 'worktree_directory')
const state = vi.spyOn(run_cut, 'current_state')
const default_branch = vi.spyOn(git_command, 'get_default_branch')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const log_path = vi.spyOn(lane_dispatch, 'default_log_path')
const launch = vi.spyOn(detached_launch, 'launch')
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

vi.spyOn(console, 'error').mockImplementation(() => undefined)

function verdict(): string {
	return String(info.mock.calls.at(-1)?.[0])
}

// A declared cut already on disk, as a fresh process would find one at its entry.
function existing_cut(): void {
	run_cut.begin_cut(target(), { issue: ISSUE, branch: BRANCH })
}

beforeEach(() => {
	vi.clearAllMocks()
	run_cut.end_cut(target())
	worktree.mockResolvedValue(REPOSITORY)
	state.mockResolvedValue(READY)
	default_branch.mockResolvedValue(DEFAULT_BRANCH)
	find_open_lane.mockResolvedValue(lane())
	log_path.mockReturnValue(DERIVED_LOG)
	launch.mockReturnValue({ kind: 'launched', pid: LAUNCHED_PID })
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
})

describe('cutting a lane child before the gate', () => {
	it('writes the record and relaunches a fresh process once', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.CUT_VERDICT)
		expect(launch.mock.calls[0]?.[0]).toStrictEqual({
			argv: { command: 'claude', args: ['-p', INVOCATION] },
			cwd: LANE_DIRECTORY,
			log_path: DERIVED_LOG,
			env: { [lane_child_marker.KEY]: ISSUE },
		})
		expect(run_cut.read_cut(target()).kind).toBe('carried')
	})

	// **The relaunch keeps the mark, so the resumed child is still a dispatched child to the pre-gate
	// cut** (joshuafolkken/kit#1904); the inherited environment is stripped on the way in, so the
	// relaunch must set it rather than rely on it carrying across.
	it('marks the relaunched child as dispatched for this issue', async () => {
		await run_cut_cli.run([ISSUE])

		expect(launch.mock.calls[0]?.[0].env).toStrictEqual({ [lane_child_marker.KEY]: ISSUE })
	})

	it('does nothing when there is no open lane for the issue', async () => {
		find_open_lane.mockResolvedValue(undefined)

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.NOT_A_LANE_VERDICT)
		expect(launch).not.toHaveBeenCalled()
	})

	it('refuses on the default branch, where there is nothing to carry', async () => {
		state.mockResolvedValue({ branch: DEFAULT_BRANCH, is_dirty: true, is_held: true })

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('refusing to cut a lane child before the gate', () => {
	it('refuses a clean tree, where the implementation is not there to carry', async () => {
		state.mockResolvedValue({ branch: BRANCH, is_dirty: false, is_held: true })

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(launch).not.toHaveBeenCalled()
	})

	it('refuses a second cut while one is already in flight', async () => {
		existing_cut()

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.BUSY_VERDICT)
		expect(launch).not.toHaveBeenCalled()
	})

	it('clears the record on a relaunch failure so the current process can carry on', async () => {
		launch.mockReturnValue({ kind: 'failed', note: 'spawn refused' })

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.FAILED_VERDICT)
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})
})

describe('a fresh process checking whether to resume', () => {
	it('reports fresh when nothing was cut', async () => {
		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.FRESH_VERDICT)
	})

	it('resumes a declared cut whose tree matches, and spends it', async () => {
		existing_cut()

		const first = await run_cut_cli.run(['--resume', ISSUE])
		const first_verdict = verdict()
		const second = await run_cut_cli.run(['--resume', ISSUE])

		expect(first).toBe(0)
		expect(first_verdict).toBe(run_cut_cli.RESUME_VERDICT)
		expect(second).toBe(1)
		expect(verdict()).toBe(run_cut_cli.STALE_VERDICT)
	})

	it('refuses to resume when the tree is clean', async () => {
		existing_cut()
		state.mockResolvedValue({ branch: BRANCH, is_dirty: false, is_held: true })

		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.STALE_VERDICT)
	})
})

describe('inspecting and clearing the record', () => {
	it('prints the record as one json line', async () => {
		existing_cut()

		await run_cut_cli.run(['--json'])

		expect(JSON.parse(verdict())).toMatchObject({
			verdict: 'carried',
			cut: { invocation: INVOCATION },
		})
	})

	it('ends the record on request', async () => {
		existing_cut()

		const code = await run_cut_cli.run(['--end'])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.ENDED_VERDICT)
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	it('refuses a resume with no issue number', async () => {
		const code = await run_cut_cli.run(['--resume'])

		expect(code).toBe(1)
	})
})
