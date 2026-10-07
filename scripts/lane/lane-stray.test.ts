import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StrayVerdict } from './lane-stray'

// joshuafolkken/kit#3370: what the lanes root holds that no registered work tree accounts for. The
// registry, the in-flight count and the object listing are mocked; the directories are real, and the
// test for removing one is `lane_leftover`'s own.

vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('./lane-registry', () => ({
	lane_registry: { main_repository_root: vi.fn(), registered_directories: vi.fn() },
}))
vi.mock('./lane-open', () => ({ lane_open: { open_in_flight_count: vi.fn() } }))

const { git_spawn } = await import('#scripts/git/git-spawn')
const { lane_registry } = await import('./lane-registry')
const { lane_open } = await import('./lane-open')
const { lane_leftover } = await import('./lane-leftover')
const { lane_paths } = await import('./lane-paths')
const { lane_stray } = await import('./lane-stray')

const scratch = mkdtempSync(path.join(tmpdir(), 'lane-stray-test-'))
const root = path.join(scratch, '.kit-lanes')
const REPOSITORY_FILE = 'scripts/a.ts'
const REPOSITORY_CONTENT = 'export {}\n'
const DANGLING_POINTER = 'gitdir: /nowhere/.git/worktrees/2509\n'
const READ_ONLY_MODE = 0o555
const WRITABLE_MODE = 0o755
const NOT_A_LANE: StrayVerdict = 'not-a-lane'

function write_file(relative: string, content: string): void {
	const file = path.join(root, relative)

	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, content)
}

// The listing `git rev-list --objects --all` would print for a history holding the repository file.
function history_holding_the_repository_file(): void {
	const probe = path.join(scratch, 'probe')

	writeFileSync(probe, REPOSITORY_CONTENT)
	vi.mocked(git_spawn.read).mockResolvedValue(
		`${lane_leftover.blob_id(probe)} ${REPOSITORY_FILE}\n`,
	)
}

function lane_entry(name: string): string {
	return path.join(root, name)
}

beforeEach(() => {
	rmSync(root, { force: true, recursive: true })
	mkdirSync(root, { recursive: true })
	vi.stubEnv(lane_paths.LANE_ROOT_KEY, root)
	vi.mocked(lane_registry.main_repository_root).mockResolvedValue(path.join(scratch, 'kit'))
	vi.mocked(lane_registry.registered_directories).mockResolvedValue([])
	vi.mocked(lane_open.open_in_flight_count).mockReturnValue(0)
	history_holding_the_repository_file()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('lane_stray.sweep_strays — what it removes', () => {
	it('removes a lane whose .git points at a registration git no longer has', async () => {
		write_file('2509/.git', DANGLING_POINTER)
		write_file(`2509/${REPOSITORY_FILE}`, REPOSITORY_CONTENT)
		write_file('2509/node_modules/pkg/index.js', 'regenerated\n')

		const strays = await lane_stray.sweep_strays()

		expect(strays.map((stray) => stray.verdict)).toStrictEqual(['removed'])
		expect(existsSync(lane_entry('2509'))).toBe(false)
	})

	it('removes a numbered directory with no .git, the shape a half-finished removal leaves', async () => {
		write_file(`3256/${REPOSITORY_FILE}`, REPOSITORY_CONTENT)

		await lane_stray.sweep_strays()

		expect(existsSync(lane_entry('3256'))).toBe(false)
	})

	it('removes an empty nested lanes root', async () => {
		const nested = lane_entry('.1665-lanes')

		mkdirSync(nested)

		await lane_stray.sweep_strays()

		expect(existsSync(nested)).toBe(false)
	})

	it('asks git nothing when the root holds no stray', async () => {
		mkdirSync(lane_entry(lane_paths.SEAT_LOCK_DIR))

		expect(await lane_stray.sweep_strays()).toStrictEqual([])
		expect(git_spawn.read).not.toHaveBeenCalled()
	})
})

describe('lane_stray.sweep_strays — what it keeps', () => {
	it('keeps a leftover holding files git cannot restore, and names them', async () => {
		const notes = '2851/notes.md'

		write_file('2851/.git', DANGLING_POINTER)
		write_file(notes, 'work in progress\n')

		const [stray] = await lane_stray.sweep_strays()

		expect(stray).toMatchObject({ verdict: 'foreign', foreign: ['notes.md'] })
		expect(existsSync(lane_entry(notes))).toBe(true)
	})

	it('never touches a registered work tree or the seat locks', async () => {
		const live = '3370/notes.md'
		const seat_locks = lane_entry(lane_paths.SEAT_LOCK_DIR)

		write_file(live, 'live work\n')
		mkdirSync(seat_locks)
		vi.mocked(lane_registry.registered_directories).mockResolvedValue([lane_entry('3370')])

		expect(await lane_stray.sweep_strays()).toStrictEqual([])
		expect(existsSync(lane_entry(live))).toBe(true)
		expect(existsSync(seat_locks)).toBe(true)
	})

	it('reports a name the lane machinery never writes and leaves it in place', async () => {
		const log = '2879-lint.txt'

		write_file(log, 'lint output\n')

		const [stray] = await lane_stray.sweep_strays()

		expect(stray?.verdict).toBe(NOT_A_LANE)
		expect(existsSync(lane_entry(log))).toBe(true)
	})

	it('keeps a numbered directory while a lane:open is in flight', async () => {
		const opening = lane_entry('3400')

		mkdirSync(opening)
		vi.mocked(lane_open.open_in_flight_count).mockReturnValue(1)

		const [stray] = await lane_stray.sweep_strays()

		expect(stray?.verdict).toBe('opening')
		expect(existsSync(opening)).toBe(true)
	})
})

// A removal git or the disk stopped part-way is what `lane:close`'s swallowed `rmSync` failure
// leaves: unregistered once `worktree prune` runs, so the next sweep is what collects it.
describe('lane_stray.sweep_strays — a removal that stopped part-way', () => {
	it('reports it as stuck, then removes it on the next sweep', async () => {
		const locked = lane_entry('3039/scripts')

		write_file(`3039/${REPOSITORY_FILE}`, REPOSITORY_CONTENT)
		chmodSync(locked, READ_ONLY_MODE)

		const [first] = await lane_stray.sweep_strays()

		chmodSync(locked, WRITABLE_MODE)

		const [second] = await lane_stray.sweep_strays()

		expect([first?.verdict, second?.verdict]).toStrictEqual(['stuck', 'removed'])
		expect(existsSync(lane_entry('3039'))).toBe(false)
	})
})

describe('lane_stray.describe', () => {
	it('names what a kept leftover holds and what to do', () => {
		const line = lane_stray.describe({ path: '/l/2851', verdict: 'foreign', foreign: ['notes.md'] })

		expect(line).toContain('notes.md')
		expect(line).toContain('/l/2851')
	})

	it('says a removed leftover was removed', () => {
		expect(lane_stray.describe({ path: '/l/2509', verdict: 'removed', foreign: [] })).toMatch(
			/^Removed/u,
		)
	})

	it('says why every other stray was kept', () => {
		const line = lane_stray.describe({ path: '/l/x.txt', verdict: NOT_A_LANE, foreign: [] })

		expect(line).toMatch(/^Kept \/l\/x\.txt: not a name/u)
	})

	it('names the seat locks a crashed lane:open leaves, so a stale lock is not waited on forever', () => {
		const line = lane_stray.describe({ path: '/l/3400', verdict: 'opening', foreign: [] })

		expect(line).toContain(lane_paths.SEAT_LOCK_DIR)
	})
})
