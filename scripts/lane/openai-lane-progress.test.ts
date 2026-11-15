import { rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_cut } from '#scripts/run/cut/run-cut'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_dispatch_dependency } from './lane-dispatch-dependency'
import type { LaneInfo } from './lane-registry'
import { lane_session_broker } from './lane-session-broker'
import { openai_lane_progress } from './openai-lane-progress'
import { openai_lane_ship } from './openai-lane-ship'
import { openai_lane_supervisor } from './openai-lane-supervisor'

const make_directory = temporary_directory('suite')

const ISSUE = '7608'
const BRANCH = '7608-lane'
const scratch = make_directory('openai-progress-test-')
const repository = path.join(scratch, 'repository.git')
const target = run_cut.cut_path(repository)
const profile = agent_role_profile.OPENAI_PROFILES.worker
const { NO_PROGRESS_CUT_LIMIT, NO_PROGRESS_REASON } = openai_lane_progress
const COMPLETED = { kind: 'completed', pid: 9001, exit_code: 0 } as const

const launch = vi.spyOn(detached_launch, 'launch_attached')
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const fixture: FixtureWorkspace = git_fixture_workspace.open_workspace('openai-progress-lane-')

function lane_directory(): string {
	return fixture.workspace
}

function stub_supervisor_surroundings(): void {
	vi.spyOn(lane_dispatch_dependency, 'check').mockResolvedValue(undefined)
	vi.spyOn(run_cut, 'worktree_directory').mockResolvedValue(repository)
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)
	vi.spyOn(openai_lane_ship, 'current').mockResolvedValue(undefined)
	vi.spyOn(openai_lane_ship, 'wait_for_ship').mockResolvedValue('none')
	vi.spyOn(lane_session_broker, 'with_server').mockImplementation(async (_lane, run) => await run())
}

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: BRANCH,
		directory: lane_directory(),
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
		profile,
	}
}

function cut(): void {
	run_cut.end_cut(target)
	run_cut.begin_cut(target, { issue: ISSUE, branch: BRANCH, phase: run_cut.IMPLEMENTATION_PHASE })
}

function edit(generation: number): void {
	writeFileSync(path.join(lane_directory(), 'work.txt'), `generation ${String(generation)}\n`)
}

// Each generation cuts; `progress[n]` says whether generation n edited the worktree first, and the
// generation after the last entry ends the chain without a cut.
function generations(progress: ReadonlyArray<boolean>): void {
	launch.mockImplementation(async () => {
		const generation = launch.mock.calls.length - 1

		if (generation >= progress.length) {
			run_cut.end_cut(target)

			return COMPLETED
		}

		if (progress[generation] === true) edit(generation)
		cut()

		return COMPLETED
	})
}

async function supervise(): Promise<number> {
	const nonce = openai_lane_supervisor.new_nonce()

	openai_lane_supervisor.approve(lane_directory(), nonce)

	return await openai_lane_supervisor.supervise(lane(), profile, nonce)
}

function stop_events(): ReadonlyArray<unknown> {
	return emit.mock.calls.filter(
		([kind, text]) =>
			kind === run_event_stream.EVENT_KIND.NOTE && text.includes(NO_PROGRESS_REASON),
	)
}

beforeAll(async () => {
	await git_fixture_workspace.git(lane_directory(), [
		'init',
		'-b',
		git_fixture_workspace.MAIN_BRANCH,
	])
	await git_fixture_workspace.git(lane_directory(), ['commit', '--allow-empty', '-m', 'init'])
})

beforeEach(() => {
	stub_supervisor_surroundings()
	emit.mockReset().mockResolvedValue(undefined)
	launch.mockReset()
	run_cut.end_cut(target)
	stamp_file.remove_stamp(openai_lane_supervisor.marker_path(lane_directory()))
	stamp_file.remove_stamp(openai_lane_supervisor.state_path(lane_directory()))
})

afterAll(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('openai_lane_progress.next_idle_cuts — consecutive cuts without progress', () => {
	it('counts a cut that left the worktree unchanged', () => {
		expect(openai_lane_progress.next_idle_cuts(1, 'same', 'same')).toBe(2)
	})

	it('resets the count when the worktree changed', () => {
		expect(openai_lane_progress.next_idle_cuts(2, 'before', 'after')).toBe(0)
	})

	it('assumes progress when the worktree could not be read', () => {
		expect(openai_lane_progress.next_idle_cuts(2, undefined, undefined)).toBe(0)
	})
})

describe('openai_lane_progress.fingerprint — the worktree state', () => {
	it('stays the same while nothing changes and moves on an edit to an untracked file', () => {
		edit(0)
		const before = openai_lane_progress.fingerprint(lane_directory())

		expect(openai_lane_progress.fingerprint(lane_directory())).toBe(before)
		edit(1)
		expect(openai_lane_progress.fingerprint(lane_directory())).not.toBe(before)
	})

	it('moves on an edit to an untracked file whose name git would quote', () => {
		const quoted = path.join(lane_directory(), 'ファイル name.txt')

		writeFileSync(quoted, 'first\n')
		const before = openai_lane_progress.fingerprint(lane_directory())

		writeFileSync(quoted, 'second\n')
		expect(before).toBeDefined()
		expect(openai_lane_progress.fingerprint(lane_directory())).not.toBe(before)
		rmSync(quoted)
	})

	it('is undefined when an untracked path cannot be hashed', async () => {
		const nested = path.join(lane_directory(), 'nested')

		await git_fixture_workspace.git(lane_directory(), ['init', '-q', nested])
		expect(openai_lane_progress.fingerprint(lane_directory())).toBeUndefined()
		rmSync(nested, { recursive: true, force: true })
	})

	it('is undefined outside a git worktree', () => {
		expect(openai_lane_progress.fingerprint(make_directory('not-a-repo-'))).toBeUndefined()
	})
})

describe('openai_lane_supervisor.supervise — no-progress cut limit', () => {
	it('stops relaunching after consecutive generations cut without progress', async () => {
		generations(Array.from({ length: NO_PROGRESS_CUT_LIMIT + 2 }, () => false))

		expect(await supervise()).toBe(1)
		expect(launch).toHaveBeenCalledTimes(NO_PROGRESS_CUT_LIMIT)
		expect(stop_events()).toHaveLength(1)
		expect(run_cut.read_cut(target).kind).toBe('carried')
	})

	it('starts the count over after a generation that ended without a cut and failed to ship', async () => {
		const ends_without_cut = 2
		const last = 5

		vi.mocked(openai_lane_ship.wait_for_ship).mockResolvedValueOnce('failed')
		launch.mockImplementation(async () => {
			const generation = launch.mock.calls.length - 1

			if (generation === ends_without_cut || generation === last) run_cut.end_cut(target)
			else cut()

			return COMPLETED
		})

		expect(await supervise()).toBe(0)
		expect(launch).toHaveBeenCalledTimes(last + 1)
		expect(stop_events()).toHaveLength(0)
	})

	it('keeps relaunching while generations cut with progress', async () => {
		generations([false, false, true, false, false])

		expect(await supervise()).toBe(0)
		expect(launch).toHaveBeenCalledTimes(6)
		expect(stop_events()).toHaveLength(0)
	})
})
