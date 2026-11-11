import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GATE_CACHE_FILES } from '#scripts/josh/josh-command-types'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_environment } from './lane-environment'
import { lane_open_git } from './lane-open-git-fixture'
import { lane_registry } from './lane-open-registry-fixture'
import { lane_paths } from './lane-paths'
import type { LaneInfo } from './lane-registry'
import { lane_seat } from './lane-seat'
import { lane_seat_fixture } from './lane-seat-fixture'
import { lane_seat_ownership } from './lane-seat-ownership'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#1490, joshuafolkken/kit#1494: opening a lane produces a work tree that keeps the
// project's own `PORT_SEED` and adds its seat in `JOSH_LANE_SEAT`. git is mocked by
// `lane-open-git-fixture.ts`, and `lane-registry.test.ts` pins the reading of the seats.

vi.mock('./lane-install', () => ({
	lane_install: { install_dependencies: vi.fn() },
}))
vi.mock('./lane-setup', () => ({ lane_setup: { run_setup: vi.fn() } }))
vi.mock('#scripts/lint/eslint-warm', () => ({ eslint_warm: { start: vi.fn() } }))
vi.mock('./lane-leftover', () => ({
	lane_leftover: { reclaim: vi.fn() },
}))
const { git_command, git_worktree, START_POINT } = lane_open_git
const { lane_install } = await import('./lane-install')
const { lane_setup } = await import('./lane-setup')
const { eslint_warm } = await import('#scripts/lint/eslint-warm')
const { lane_leftover } = await import('./lane-leftover')
const { lane_open } = await import('./lane-open')

const scratch = make_directory('lane-open-test-')
const REPOSITORY_ROOT = path.join(scratch, 'kit')
const LANE_ROOT = path.join(scratch, 'lanes')
const BOT_TOKEN = 'TELEGRAM_BOT_TOKEN=abc:123'
const CHAT_ID = 'TELEGRAM_CHAT_ID=42'
const ROOT_SEED_LINE = 'PORT_SEED=5'
const SEAT_1_LINE = 'JOSH_LANE_SEAT=1'
const SEAT_2_LINE = 'JOSH_LANE_SEAT=2'
const RESERVED_SEAT = 5
const LOCK_DIRECTORY = '.seat-locks'
const ROOT_ENV = [BOT_TOKEN, CHAT_ID, ROOT_SEED_LINE, ''].join('\n')
// The permission bits are the mode below the file-type bits, `0o777` at most.
const PERMISSION_RANGE = 0o1000
const ISSUE = '1490'
const OTHER_ISSUE = '1491'
const DEV_BASE = 5173
const PREVIEW_BASE = 4173
// What `prepare` prints in a linked work tree, whose hooks belong to the primary repository
// (joshuafolkken/kit#1503, #1507). It rides on a successful install and must not refuse the lane.
const LEFTHOOK_WARNING = 'lefthook install failed: git hooks are NOT installed.'
const INSTALL_FAILURE = 'ERR_PNPM_OUTDATED_LOCKFILE'
const REFUSAL = 'holds files'
const PORT_KINDS = ['development', 'preview'] as const

function install_answers(is_installed: boolean, output: string): void {
	vi.mocked(lane_install.install_dependencies).mockResolvedValue({ is_installed, output })
}

afterAll(() => {
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function root_environment_file(): string {
	return readFileSync(path.join(REPOSITORY_ROOT, '.env'), 'utf8')
}

function lane_environment_file(issue: string): string {
	return readFileSync(path.join(LANE_ROOT, issue, '.env'), 'utf8')
}

function lane_environment_mode(issue: string): number {
	return statSync(path.join(LANE_ROOT, issue, '.env')).mode % PERMISSION_RANGE
}

function seat_lock_path(seat: number): string {
	return path.join(LANE_ROOT, LOCK_DIRECTORY, `seat-${String(seat)}`)
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

beforeEach(lane_seat_fixture.mock_ownership)

beforeEach(() => {
	rmSync(LANE_ROOT, { force: true, recursive: true })
	mkdirSync(REPOSITORY_ROOT, { recursive: true })
	writeFileSync(path.join(REPOSITORY_ROOT, '.env'), ROOT_ENV)
	process.env[lane_paths.LANE_ROOT_KEY] = LANE_ROOT
	lanes_are([])
	install_answers(true, '')
	vi.mocked(lane_registry.main_repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(lane_leftover.reclaim).mockReset()
	// The stage an open writes goes to the checkout's own stream, which is a live run's: never from a test.
	vi.spyOn(run_event_setup, 'emit').mockReset().mockResolvedValue()
	lane_open_git.git_answers()
})

it('writes the seat acquired by the shared allocator rather than choosing one independently', async () => {
	vi.spyOn(lane_seat, 'reserve').mockResolvedValue({
		seat: RESERVED_SEAT,
		lock: seat_lock_path(RESERVED_SEAT),
		issue_lock: path.join(LANE_ROOT, LOCK_DIRECTORY, `lane-${ISSUE}`),
	})
	await lane_open.open_lane(ISSUE)

	expect(lane_environment_file(ISSUE)).toContain(`JOSH_LANE_SEAT=${String(RESERVED_SEAT)}`)
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
		// joshuafolkken/kit#4653: a Codex lane's sandbox cannot write the upstream its push would set.
		expect(vi.mocked(git_worktree.set_upstream)).toHaveBeenCalledWith('1490-lane')
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

	// joshuafolkken/kit#4634: the copy carries the root's Telegram token, so only its owner reads it.
	it('writes the lane .env readable by its owner only', async () => {
		await lane_open.open_lane(ISSUE)

		expect(lane_environment_mode(ISSUE)).toBe(lane_registry.OWNER_ONLY_MODE)
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

// joshuafolkken/kit#2857: a directory git does not register is cleared, or refused, before anything
// is created — `lane-leftover.test.ts` pins which leftovers are cleared.
describe('a leftover directory at the lane path', () => {
	it('is handed to the leftover check before the work tree is added', async () => {
		await lane_open.open_lane(ISSUE)

		expect(vi.mocked(lane_leftover.reclaim)).toHaveBeenCalledWith(path.join(LANE_ROOT, ISSUE))
	})

	it('stops the open, without a work tree or a seat lock, when the check refuses it', async () => {
		vi.mocked(lane_leftover.reclaim).mockRejectedValue(new Error(REFUSAL))

		await expect(lane_open.open_lane(ISSUE)).rejects.toThrow(REFUSAL)
		expect(vi.mocked(git_worktree.worktree_add)).not.toHaveBeenCalled()
		expect(existsSync(seat_lock_path(1))).toBe(false)
	})
})

describe('claiming a lane seat atomically', () => {
	// The seat is claimed by exclusively creating its lock directory, so once the lane's `.env` is on
	// disk the lock is released and only a hard crash mid-open could strand one (joshuafolkken/kit#1494).
	it('releases the seat lock once the lane is on disk', async () => {
		await lane_open.open_lane(ISSUE)

		expect(existsSync(seat_lock_path(1))).toBe(false)
	})

	// The lock's window is the unreadable window and no longer: once the `.env` is on disk the lane is
	// readable, so the lock is dropped before the multi-minute install runs. A lock outlasting that
	// window would inflate the in-flight count and mask a genuinely broken lane (joshuafolkken/kit#2147).
	it('holds the seat lock until installation finishes, then releases it', async () => {
		let is_lock_held_during_install = true

		vi.mocked(lane_install.install_dependencies).mockImplementation(async () => {
			is_lock_held_during_install = existsSync(seat_lock_path(1))

			return { is_installed: true, output: '' }
		})

		await lane_open.open_lane(ISSUE)

		expect(is_lock_held_during_install).toBe(true)
	})

	// The lock is what closes the gap between reading the free seats and writing the `.env`: a seat
	// another open already holds cannot be claimed, so this open steps to the next free one.
	it('steps past a seat whose lock another open already holds', async () => {
		mkdirSync(seat_lock_path(1), { recursive: true })

		await lane_open.open_lane(ISSUE)

		expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
	})

	// A lane git already lists but whose `.env` is not yet written is mid-open, not broken: it holds a
	// seat lock across that window. Read as broken, a second concurrent open would throw instead of
	// stepping past it (joshuafolkken/kit#2147).
	it('opens past an unreadable lane that still holds its seat lock', async () => {
		mkdirSync(seat_lock_path(1), { recursive: true })
		mkdirSync(path.join(LANE_ROOT, LOCK_DIRECTORY, `lane-${OTHER_ISSUE}`))
		lanes_are([live_lane(OTHER_ISSUE, undefined)])

		const outcome = await lane_open.open_lane(ISSUE)

		expect(outcome.kind).toBe('opened')
		expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
	})
})

describe('opening a lane — its dependencies', () => {
	// The work tree is the container and this is its contents: without them the first `pnpm josh …`
	// typed in the lane fails with `tsx: command not found` (joshuafolkken/kit#1554). It is asked for
	// the lane's own directory, never the one `lane:open` was typed in. Its eslint daemon is warmed
	// after it, so the child's first edit hook lints warm (joshuafolkken/kit#4720).
	it('installs the dependencies into the lane it just created, then warms its eslint', async () => {
		await lane_open.open_lane(ISSUE)

		const install = vi.mocked(lane_install.install_dependencies)

		expect(install).toHaveBeenCalledWith(path.join(LANE_ROOT, ISSUE))
		expect(eslint_warm.start).toHaveBeenCalledWith(path.join(LANE_ROOT, ISSUE))
		expect(install).toHaveBeenCalledBefore(vi.mocked(eslint_warm.start))
	})

	// joshuafolkken/kit#3738: the install is the long part of an open, so it is a stage of its own.
	it('says the install on the run’s stream before it starts', async () => {
		await lane_open.open_lane(ISSUE)

		expect(run_event_setup.emit).toHaveBeenCalledExactlyOnceWith(
			`installing dependencies #${ISSUE}`,
		)
		expect(run_event_setup.emit).toHaveBeenCalledBefore(
			vi.mocked(lane_install.install_dependencies),
		)
	})

	it('says no install for a lane that is already open', async () => {
		lanes_are([live_lane(ISSUE, 1)])

		await lane_open.open_lane(ISSUE)

		expect(run_event_setup.emit).not.toHaveBeenCalled()
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

	// Reported as success, a failed install leaves a lane nothing runs in (#1554).
	it('refuses a failed install with its output and both recovery commands', async () => {
		install_answers(false, INSTALL_FAILURE)
		const failure = lane_open.open_lane(ISSUE)

		await expect(failure).rejects.toThrow(/pnpm josh lane:close 1490/u)
		await expect(failure).rejects.toThrow(/install --frozen-lockfile/u)
		await expect(failure).rejects.toThrow(new RegExp(INSTALL_FAILURE, 'u'))
	})
})

it.each(PORT_KINDS)('quarantines an unreadable lane with its %s port bound', async (kind) => {
	const ports = lane_environment.read_lane_ports(lane_environment.lane_file_content(ROOT_ENV, 1))

	vi.mocked(lane_seat_ownership.snapshot).mockResolvedValue({
		running: new Set(),
		ports: new Set([ports[kind]]),
	})
	const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	lanes_are([live_lane(OTHER_ISSUE, undefined)])

	const outcome = await lane_open.open_lane(ISSUE)

	expect(outcome.kind).toBe('opened')
	expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
	expect(report).toHaveBeenCalledWith(expect.stringMatching(/#1491.*unreadable \.env/u))
})

it('refuses allocation when port ownership cannot be read', async () => {
	vi.mocked(lane_seat_ownership.snapshot).mockResolvedValue(undefined)

	await expect(lane_open.open_lane(ISSUE)).rejects.toThrow(lane_seat_ownership.UNREADABLE)
	expect(vi.mocked(git_worktree.worktree_add)).not.toHaveBeenCalled()
})

it('opens beyond a held lock even when multiple lanes are unreadable', async () => {
	mkdirSync(seat_lock_path(1), { recursive: true })
	lanes_are([live_lane(OTHER_ISSUE, undefined), live_lane('1492', undefined)])

	const outcome = await lane_open.open_lane(ISSUE)

	expect(outcome.kind).toBe('opened')
	expect(lane_environment_file(ISSUE)).toContain(SEAT_2_LINE)
})

// joshuafolkken/kit#1849: a fresh work tree has none of the git-ignored gate caches, so the lane's
// first `josh gate` runs cold; opening copies them from the main checkout so it starts warm. The
// unit-level behavior is `lane-cache.test.ts`; what belongs here is that the open wires the main
// repository root through to the copy.
it('seeds the gate caches the main checkout has into the new lane', async () => {
	for (const cache_file of GATE_CACHE_FILES) {
		writeFileSync(path.join(REPOSITORY_ROOT, cache_file), JSON.stringify({ cache_file }))
	}

	await lane_open.open_lane(ISSUE)

	for (const cache_file of GATE_CACHE_FILES) {
		expect(readFileSync(path.join(LANE_ROOT, ISSUE, cache_file), 'utf8')).toBe(
			JSON.stringify({ cache_file }),
		)
	}
})

// joshuafolkken/kit#1627: a branch that is already here is attached to rather than created, and the
// absent start point is how that reaches git. Which of the three answers `lane_start_point` gives is
// its own suite's; what belongs here is that `lane:open` passes it straight through.
it('asks git for no start point, so the work tree lands on that branch', async () => {
	vi.mocked(git_command.branch_exists).mockResolvedValue(true)

	await lane_open.open_lane(ISSUE)

	expect(vi.mocked(git_worktree.worktree_add)).toHaveBeenCalledWith(
		path.join(LANE_ROOT, ISSUE),
		'1490-lane',
		undefined,
	)
})

// joshuafolkken/kit#7203: the project's setup runs in the lane after the install, told the main checkout.
it('runs the project setup after the install, with the main checkout', async () => {
	await lane_open.open_lane(ISSUE)

	const setup = vi.mocked(lane_setup.run_setup)

	expect(setup).toHaveBeenCalledWith(
		expect.objectContaining({ directory: path.join(LANE_ROOT, ISSUE) }),
		REPOSITORY_ROOT,
	)
	expect(vi.mocked(lane_install.install_dependencies)).toHaveBeenCalledBefore(setup)
})
