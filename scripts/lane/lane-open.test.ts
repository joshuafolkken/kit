import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_paths } from './lane-paths'
import type { LaneInfo } from './lane-registry'

// joshuafolkken/kit#1490, joshuafolkken/kit#1494: opening a lane produces a work tree that keeps the
// project's own `PORT_SEED` and adds its seat in `JOSH_LANE_SEAT`. `git_command` is mocked because
// the assertions are about what this module asks git for and what it writes beside it, not about git
// itself — `git-worktree.test.ts` pins the flags of the worktree calls, and `lane-registry.test.ts`
// the reading of the seats.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch_exists: vi.fn(),
		branch_names_remote: vi.fn(),
		default_branch_reference: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-worktree', () => ({
	git_worktree: {
		ls_remote_branch: vi.fn(),
		worktree_add: vi.fn(),
	},
}))
vi.mock('./lane-install', () => ({
	lane_install: { install_dependencies: vi.fn() },
}))
vi.mock('./lane-registry', () => ({
	lane_registry: {
		find_lane: (lanes: ReadonlyArray<LaneInfo>, issue: string): LaneInfo | undefined =>
			lanes.find((lane) => lane.issue === issue),
		list_lanes: vi.fn(),
		main_repository_root: vi.fn(),
		unreadable_lanes: (lanes: ReadonlyArray<LaneInfo>): Array<LaneInfo> =>
			lanes.filter((lane) => !lane.is_stranded && lane.seat === undefined),
		used_seats: (lanes: ReadonlyArray<LaneInfo>): Array<number> =>
			lanes.flatMap((lane) => (lane.seat === undefined ? [] : [lane.seat])),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { git_worktree } = await import('#scripts/git/git-worktree')
const { lane_install } = await import('./lane-install')
const { lane_registry } = await import('./lane-registry')
const { lane_open } = await import('./lane-open')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-open-test-'))
const REPOSITORY_ROOT = path.join(scratch, 'kit')
const LANE_ROOT = path.join(scratch, 'lanes')
const BOT_TOKEN = 'TELEGRAM_BOT_TOKEN=abc:123'
const CHAT_ID = 'TELEGRAM_CHAT_ID=42'
const ROOT_SEED_LINE = 'PORT_SEED=5'
const SEAT_1_LINE = 'JOSH_LANE_SEAT=1'
const SEAT_2_LINE = 'JOSH_LANE_SEAT=2'
const ROOT_ENV = [BOT_TOKEN, CHAT_ID, ROOT_SEED_LINE, ''].join('\n')
const ISSUE = '1490'
const OTHER_ISSUE = '1491'
const START_POINT = 'refs/remotes/origin/main'
const DEV_BASE = 5173
const PREVIEW_BASE = 4173
// What `prepare` prints in a linked work tree, whose hooks belong to the primary repository
// (joshuafolkken/kit#1503, #1507). It rides on a successful install and must not refuse the lane.
const LEFTHOOK_WARNING = 'lefthook install failed: git hooks are NOT installed.'
const INSTALL_FAILURE = 'ERR_PNPM_OUTDATED_LOCKFILE'

function install_answers(is_installed: boolean, output: string): void {
	vi.mocked(lane_install.install_dependencies).mockResolvedValue({ is_installed, output })
}

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
})

function root_environment_file(): string {
	return readFileSync(path.join(REPOSITORY_ROOT, '.env'), 'utf8')
}

function lane_environment_file(issue: string): string {
	return readFileSync(path.join(LANE_ROOT, issue, '.env'), 'utf8')
}

function seat_lock_path(seat: number): string {
	return path.join(LANE_ROOT, '.seat-locks', `seat-${String(seat)}`)
}

function live_lane(issue: string, seat: number | undefined): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: path.join(LANE_ROOT, issue),
		seat,
		development_port: seat === undefined ? undefined : DEV_BASE + seat,
		preview_port: seat === undefined ? undefined : PREVIEW_BASE + seat,
		output: undefined,
		is_stranded: false,
	}
}

function lanes_are(lanes: ReadonlyArray<LaneInfo>): void {
	vi.mocked(lane_registry.list_lanes).mockResolvedValue([...lanes])
}

function git_answers(): void {
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_command.fetch_branch).mockResolvedValue('')
	// No branch of the lane's name anywhere, which is what opening a lane for a fresh child finds
	// (joshuafolkken/kit#1627). The suite that drives the other two answers is
	// `lane-open-start-point.test.ts`, against real git.
	vi.mocked(git_command.branch_exists).mockResolvedValue(false)
	vi.mocked(git_command.branch_names_remote).mockResolvedValue([])
	vi.mocked(git_worktree.ls_remote_branch).mockResolvedValue('')
	vi.mocked(git_command.default_branch_reference).mockResolvedValue(START_POINT)
	// Stands in for what `git worktree add` does to the filesystem, so the `.env` write that follows
	// it has somewhere to land.
	vi.mocked(git_worktree.worktree_add).mockImplementation(async (directory: string) => {
		mkdirSync(directory, { recursive: true })

		return ''
	})
}

beforeEach(() => {
	rmSync(LANE_ROOT, { force: true, recursive: true })
	mkdirSync(REPOSITORY_ROOT, { recursive: true })
	writeFileSync(path.join(REPOSITORY_ROOT, '.env'), ROOT_ENV)
	process.env[lane_paths.LANE_ROOT_KEY] = LANE_ROOT
	lanes_are([])
	install_answers(true, '')
	vi.mocked(lane_registry.main_repository_root).mockResolvedValue(REPOSITORY_ROOT)
	git_answers()
})

describe('opening a lane', () => {
	// The start point is the remote-tracking ref, not the bare name: the bare name resolves to the
	// local branch, which nothing in this workflow advances (joshuafolkken/kit#1535).
	it('creates a work tree with its own branch, from the merged default branch', async () => {
		const outcome = await lane_open.open_lane(ISSUE)

		expect(outcome.kind).toBe('opened')
		expect(vi.mocked(git_worktree.worktree_add)).toHaveBeenCalledWith(
			path.join(LANE_ROOT, ISSUE),
			'1490-lane',
			START_POINT,
		)
	})

	// The lane keeps the project's seed and adds only its seat, so the file shows the two apart and the
	// root `.env` is left exactly as it was — a project that never opens a lane keeps today's ports.
	it('adds the lane its own seat, keeps the project seed, and leaves the root alone', async () => {
		await lane_open.open_lane(ISSUE)

		const written = lane_environment_file(ISSUE)

		expect(written).toContain(SEAT_1_LINE)
		expect(written).toContain(ROOT_SEED_LINE)
		expect(written).toContain(BOT_TOKEN)
		expect(written).toContain(CHAT_ID)
		expect(root_environment_file()).toBe(ROOT_ENV)
	})

	it('takes the lowest seat no open lane holds', async () => {
		lanes_are([live_lane(OTHER_ISSUE, 1)])

		await lane_open.open_lane(ISSUE)

		expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
	})

	it('still gives a lane a seat when the root has no .env at all', async () => {
		rmSync(path.join(REPOSITORY_ROOT, '.env'), { force: true })

		await lane_open.open_lane(ISSUE)

		expect(lane_environment_file(ISSUE)).toBe(`${SEAT_1_LINE}\n`)
	})
})

describe('claiming a lane seat atomically', () => {
	// The seat is claimed by exclusively creating its lock directory, so once the lane's `.env` is on
	// disk the lock is released and only a hard crash mid-open could strand one (joshuafolkken/kit#1494).
	it('releases the seat lock once the lane is on disk', async () => {
		await lane_open.open_lane(ISSUE)

		expect(existsSync(seat_lock_path(1))).toBe(false)
	})

	// The lock is what closes the gap between reading the free seats and writing the `.env`: a seat
	// another open already holds cannot be claimed, so this open steps to the next free one.
	it('steps past a seat whose lock another open already holds', async () => {
		mkdirSync(seat_lock_path(1), { recursive: true })

		await lane_open.open_lane(ISSUE)

		expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
	})
})

describe('opening a lane — its dependencies', () => {
	// The work tree is the container and this is its contents: without them the first `pnpm josh …`
	// typed in the lane fails with `tsx: command not found` (joshuafolkken/kit#1554). It is asked for
	// the lane's own directory, never the one `lane:open` was typed in.
	it('installs the dependencies into the lane it just created', async () => {
		await lane_open.open_lane(ISSUE)

		expect(vi.mocked(lane_install.install_dependencies)).toHaveBeenCalledWith(
			path.join(LANE_ROOT, ISSUE),
		)
	})

	// The hooks of a linked work tree belong to the primary repository, so the installer warning is
	// the expected state rather than a fault — and the lane opens through it.
	it('opens the lane through a lefthook warning that rode on a successful install', async () => {
		install_answers(true, LEFTHOOK_WARNING)

		const outcome = await lane_open.open_lane(ISSUE)

		expect(outcome.kind).toBe('opened')
	})
})

describe('refusing to open a lane', () => {
	// Reopening would mean `worktree add` onto a path git still registers, after this side had
	// already handed the caller a second seat.
	it('refuses a lane that is already open, and asks git for nothing', async () => {
		lanes_are([live_lane(ISSUE, 1)])

		const outcome = await lane_open.open_lane(ISSUE)

		expect(outcome.kind).toBe('already-open')
		expect(vi.mocked(git_worktree.worktree_add)).not.toHaveBeenCalled()
	})

	it('refuses once every seat is taken, rather than reusing one', async () => {
		const seats = [1, 2, 3, 4, 5, 6, 7, 8, 9]

		lanes_are(seats.map((seat) => live_lane(String(seat), seat)))

		const outcome = await lane_open.open_lane(ISSUE)

		expect(outcome.kind).toBe('full')
		expect(vi.mocked(git_worktree.worktree_add)).not.toHaveBeenCalled()
	})

	// Read as free, that lane's seat would go to the new lane while its ports are still bound.
	it('fails loudly when a live lane seat cannot be read, rather than allocating over it', async () => {
		lanes_are([live_lane(OTHER_ISSUE, undefined)])

		await expect(lane_open.open_lane(ISSUE)).rejects.toThrow(/#1491/u)
		expect(vi.mocked(git_worktree.worktree_add)).not.toHaveBeenCalled()
	})

	// Reported as a success, the caller would capture the directory and type the first `pnpm josh …`
	// into a lane nothing runs in — the failure the install exists to remove, with a success line
	// above it (joshuafolkken/kit#1554). The refusal names both ways out, because the work tree is
	// left on disk and either one needs it.
	it('refuses the lane when the install failed, naming both ways out', async () => {
		install_answers(false, INSTALL_FAILURE)

		const failure = lane_open.open_lane(ISSUE)

		await expect(failure).rejects.toThrow(/pnpm josh lane:close 1490/u)
		await expect(failure).rejects.toThrow(/install --frozen-lockfile/u)
	})

	// Diagnosing it needs pnpm's own words; the caller has nothing else to go on.
	it('carries the failed install output into the refusal', async () => {
		install_answers(false, INSTALL_FAILURE)

		await expect(lane_open.open_lane(ISSUE)).rejects.toThrow(new RegExp(INSTALL_FAILURE, 'u'))
	})
})

// joshuafolkken/kit#1627: a branch that is already here is attached to rather than created, and the
// absent start point is how that reaches git. Which of the three answers `lane_start_point` gives is
// its own suite's; what belongs here is that `lane:open` passes it straight through.
describe('opening a lane on a branch that already exists', () => {
	it('asks git for no start point, so the work tree lands on that branch', async () => {
		vi.mocked(git_command.branch_exists).mockResolvedValue(true)

		await lane_open.open_lane(ISSUE)

		expect(vi.mocked(git_worktree.worktree_add)).toHaveBeenCalledWith(
			path.join(LANE_ROOT, ISSUE),
			'1490-lane',
			undefined,
		)
	})
})
