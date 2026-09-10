import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_paths } from './lane-paths'
import type { LaneInfo } from './lane-registry'

// joshuafolkken/kit#1490: a lane is closed after a park, a failure or an interruption as readily as
// after a success, so what is asserted here is that **nothing is left** in each of those states —
// not that every git call succeeded.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch_exists: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: {
		branch_delete: vi.fn(),
		worktree_prune: vi.fn(),
		worktree_remove: vi.fn(),
	},
}))
vi.mock('./lane-registry', () => ({
	lane_registry: {
		find_lane: (lanes: ReadonlyArray<LaneInfo>, issue: string): LaneInfo | undefined =>
			lanes.find((lane) => lane.issue === issue),
		list_lanes: vi.fn(),
		main_repository_root: vi.fn(),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_worktree } = await import('#scripts/git/git-worktree')
const { lane_registry } = await import('./lane-registry')
const { lane_close } = await import('./lane-close')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-close-test-'))
const REPOSITORY_ROOT = path.join(scratch, 'kit')
const LANE_ROOT = path.join(scratch, 'lanes')
const ISSUE = '1490'
const OTHER_ISSUE = '1491'
const LANE_BRANCH = '1490-lane'
const SEED = 6

function lane_of(issue: string, seed: number): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: path.join(LANE_ROOT, issue),
		seed,
		output: undefined,
		is_stranded: false,
	}
}

// A lane with uncommitted work in it — the state a park or a failure leaves, and the one a close
// that refused to force would walk away from.
function open_on_disk(issue: string, seed: number): LaneInfo {
	const lane = lane_of(issue, seed)

	mkdirSync(lane.directory, { recursive: true })
	writeFileSync(path.join(lane.directory, 'uncommitted.txt'), 'work in progress')
	writeFileSync(path.join(lane.directory, '.env'), `PORT_SEED=${String(seed)}\n`)

	return lane
}

function lanes_are(lanes: ReadonlyArray<LaneInfo>): void {
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([...lanes])
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
})

beforeEach(() => {
	rmSync(LANE_ROOT, { force: true, recursive: true })
	mkdirSync(LANE_ROOT, { recursive: true })
	process.env[lane_paths.LANE_ROOT_KEY] = LANE_ROOT
	lanes_are([])
	vi.mocked(lane_registry.main_repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(git_worktree.worktree_prune).mockResolvedValue('')
	vi.mocked(git_worktree.branch_delete).mockResolvedValue('')
	vi.mocked(git_command.branch_exists).mockResolvedValue(false)
	// What `git worktree remove --force` does: unregisters and deletes, uncommitted work and all.
	vi.mocked(git_worktree.worktree_remove).mockImplementation(async (directory: string) => {
		rmSync(directory, { force: true, recursive: true })

		return ''
	})
})

describe('closing a lane', () => {
	it('leaves no work tree, no branch and no directory', async () => {
		const lane = open_on_disk(ISSUE, SEED)

		lanes_are([lane])

		const outcome = await lane_close.close_lane(ISSUE)

		expect(outcome.kind).toBe('closed')
		expect(existsSync(lane.directory)).toBe(false)
		expect(vi.mocked(git_worktree.branch_delete)).toHaveBeenCalledWith(LANE_BRANCH)
	})

	// The state a crash between `worktree add` and the `.env` write leaves: the issue number still
	// implies both paths, which is what makes such a lane closable at all.
	it('closes a lane git never registered', async () => {
		mkdirSync(path.join(LANE_ROOT, ISSUE), { recursive: true })

		const outcome = await lane_close.close_lane(ISSUE)

		expect(outcome.kind).toBe('closed')
		expect(existsSync(path.join(LANE_ROOT, ISSUE))).toBe(false)
	})

	it('still removes the directory when git refuses the work tree', async () => {
		const lane = open_on_disk(ISSUE, SEED)

		lanes_are([lane])
		vi.mocked(git_worktree.worktree_remove).mockRejectedValue(new Error('not a working tree'))

		await lane_close.close_lane(ISSUE)

		expect(existsSync(lane.directory)).toBe(false)
		expect(vi.mocked(git_worktree.branch_delete)).toHaveBeenCalledWith(LANE_BRANCH)
	})

	it('answers none for a lane that was never opened, rather than failing', async () => {
		const outcome = await lane_close.close_lane('9999')

		expect(outcome.kind).toBe('none')
	})
})

describe('judging a close by what is left', () => {
	// The verdict is the end state, not the exit codes: every removal step is expected to fail on some
	// legitimate path, and a branch that survived sends the next `lane:open` into git's own refusal.
	it('reports the close as incomplete when the branch survives, naming what is left', async () => {
		lanes_are([open_on_disk(ISSUE, SEED)])
		vi.mocked(git_worktree.branch_delete).mockRejectedValue(new Error('ref lock'))
		vi.mocked(git_command.branch_exists).mockResolvedValue(true)

		const outcome = await lane_close.close_lane(ISSUE)

		expect(outcome.kind).toBe('incomplete')
		expect(outcome.left_behind).toStrictEqual([LANE_BRANCH])
	})
})

describe('sweeping up after an interruption', () => {
	it('prunes only the lanes whose work tree is gone', async () => {
		const live = open_on_disk(ISSUE, SEED)
		const stranded = { ...lane_of(OTHER_ISSUE, SEED + 1), is_stranded: true, seed: undefined }

		lanes_are([live, stranded])

		expect(await lane_close.prune_lanes()).toStrictEqual({ closed: [OTHER_ISSUE], failed: [] })
		expect(existsSync(live.directory)).toBe(true)
	})

	it('closes every open lane on request', async () => {
		const lanes = [open_on_disk(ISSUE, SEED), open_on_disk(OTHER_ISSUE, SEED + 1)]

		lanes_are(lanes)

		expect(await lane_close.close_all_lanes()).toStrictEqual({
			closed: [ISSUE, OTHER_ISSUE],
			failed: [],
		})
		expect(lanes.filter((lane) => existsSync(lane.directory))).toStrictEqual([])
	})

	// One lane that will not go must not take the rest of the sweep down with it, and the caller has
	// to be told which ones are still there.
	it('closes the other lanes when one of them fails, and reports the failure', async () => {
		lanes_are([open_on_disk(ISSUE, SEED), open_on_disk(OTHER_ISSUE, SEED + 1)])
		vi.mocked(git_command.branch_exists).mockImplementation(
			async (branch: string) => branch === LANE_BRANCH,
		)

		expect(await lane_close.close_all_lanes()).toStrictEqual({
			closed: [OTHER_ISSUE],
			failed: [ISSUE],
		})
	})
})
