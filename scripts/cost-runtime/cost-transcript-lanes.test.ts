import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cost_transcript } from './cost-transcript'
import { cost_transcript_fixture } from './cost-transcript-fixture'

const { CWD, usage_line } = cost_transcript_fixture
const MAIN = CWD

// A linked work tree as git leaves one: its `.git` is a *file* naming the main checkout's worktree
// registration, which is what says where the session's transcripts are actually filed.
function make_worktree(gitdir: string): string {
	const root = mkdtempSync(path.join(tmpdir(), 'cost-worktree-'))

	writeFileSync(path.join(root, '.git'), `gitdir: ${gitdir}\n`)

	return root
}

// A transcript filed under an arbitrary working directory's slug, so a lane's own slug and the main
// checkout's can each be populated independently (joshuafolkken/kit#1825).
function write_transcript(home: string, cwd: string, session_id: string, content: string): void {
	const directory = cost_transcript.transcript_directory(cwd, home)

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${session_id}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		content,
	)
}

// A lane work tree whose `.git` file resolves to the main checkout `MAIN`, paired with a fresh home.
function lane_home(): { home: string; lane: string } {
	const home = mkdtempSync(path.join(tmpdir(), 'cost-for-'))

	return { home, lane: make_worktree(`${MAIN}/.git/worktrees/1825`) }
}

function directories_of(home: string, lane: string): Array<string> {
	return cost_transcript.transcript_directories(lane, home)
}

function ids_for(home: string, lane: string): Array<string> {
	return cost_transcript
		.list_sessions_across(directories_of(home, lane))
		.map((file) => file.session_id)
}

describe('cost_transcript.list_sessions_across', () => {
	// joshuafolkken/kit#1749 files a dispatched lane child's transcript under the lane's own slug.
	it('finds a transcript filed under the lane own slug', () => {
		const { home, lane } = lane_home()

		write_transcript(home, lane, 'lane-run', usage_line('r1', 5))

		expect(ids_for(home, lane)).toStrictEqual(['lane-run'])
	})

	// joshuafolkken/kit#2236: a lane never reads the main checkout it resolves to, so a connected
	// conversation session's transcript under the main slug is not a candidate from the lane.
	it('does not read the main checkout slug from a lane', () => {
		const { home, lane } = lane_home()

		write_transcript(home, MAIN, 'main-run', usage_line('r1', 5))

		expect(ids_for(home, lane)).toStrictEqual([])
	})

	// The bug this fixes: the main slug held a larger, newer connected session, so the child measured
	// that session as its own. The lane's own record is what a lane cwd reads (joshuafolkken/kit#2236).
	it('returns the lane own record when the main checkout has a larger, newer one', () => {
		const { home, lane } = lane_home()

		write_transcript(home, lane, 'lane-run', usage_line('r1', 5))
		write_transcript(home, MAIN, 'main-run', [usage_line('r2', 9), usage_line('r3', 9)].join('\n'))

		expect(ids_for(home, lane)).toStrictEqual(['lane-run'])
	})

	// A defensive dedupe keeps a merge from doubling what it measured should one id surface under two
	// of the directories the walk hands it.
	it('counts a session found under two candidate directories once', () => {
		const { home, lane } = lane_home()
		const directory = cost_transcript.transcript_directory(lane, home)

		write_transcript(home, lane, 'shared', usage_line('r1', 5))

		expect(cost_transcript.list_sessions_across([directory, directory])).toHaveLength(1)
	})

	it('returns nothing when the lane slug has no transcript', () => {
		const { home, lane } = lane_home()

		expect(cost_transcript.list_sessions_across(directories_of(home, lane))).toStrictEqual([])
	})

	// joshuafolkken/kit#2236: the candidate set from a lane is exactly its own slug on every call, so a
	// run measuring itself twice at the same moment cannot see the verdict flip.
	it('resolves a lane to the same single directory on repeated calls', () => {
		const { home, lane } = lane_home()

		expect(directories_of(home, lane)).toStrictEqual(directories_of(home, lane))
		expect(directories_of(home, lane)).toStrictEqual([
			cost_transcript.transcript_directory(lane, home),
		])
	})
})

describe('cost_transcript.searched_directories', () => {
	// joshuafolkken/kit#2236: a lane's only candidate is its own slug, so the missing message names it
	// alone rather than the main checkout it can no longer read.
	it('reports the lane own candidate slug, absent when nothing was written', () => {
		const { home, lane } = lane_home()

		const searched = cost_transcript.searched_directories(directories_of(home, lane))

		expect(searched).toStrictEqual([
			{ path: cost_transcript.transcript_directory(lane, home), exists: false },
		])
	})

	it('distinguishes an existing directory from an absent one', () => {
		const present = mkdtempSync(path.join(tmpdir(), 'cost-present-'))
		const absent = path.join(present, 'gone')

		const searched = cost_transcript.searched_directories([present, absent])

		expect(searched.find((directory) => directory.path === present)?.exists).toBe(true)
		expect(searched.find((directory) => directory.path === absent)?.exists).toBe(false)
	})
})

// The store is keyed on the *session's* working directory, and a lane is a checkout no session ever
// ran in: `epicrun` gave each child a linked work tree and the child prefixed every command with it,
// while the Claude session stayed in the main checkout. So `pnpm josh time` invoked from a lane asked
// for a project directory that does not exist, `read_directory` swallowed the miss, and every
// transcript-derived row reported as unmeasured (joshuafolkken/kit#1617).
describe('cost_transcript.session_cwd', () => {
	it('resolves a linked work tree to the checkout its transcripts are filed under', () => {
		const lane = make_worktree(`${CWD}/.git/worktrees/1617`)

		expect(cost_transcript.session_cwd(lane)).toBe(CWD)
	})

	// Git writes a relative pointer under `worktree.useRelativePaths`, or for a tree added with
	// `--relative-paths`. Sliced as text that yields `../../kit`, which slugs to `------kit` and finds
	// no transcripts at all — the same failure, with a nonsense path in the message reporting it.
	it('resolves a relative work tree pointer against the work tree itself', () => {
		const lane = make_worktree('../kit/.git/worktrees/1617')

		expect(cost_transcript.session_cwd(lane)).toBe(path.resolve(lane, '..', 'kit'))
	})

	it('leaves a main checkout alone, whose .git is a directory rather than a pointer', () => {
		expect(cost_transcript.session_cwd(CWD)).toBe(CWD)
	})

	// A submodule's `.git` is a pointer too, and it names no work tree registration — so the fallback
	// has to be the cwd itself rather than whatever prefix a looser parse would find.
	it('leaves a pointer that names no work tree registration alone', () => {
		const submodule = make_worktree(`${CWD}/.git/modules/vendor`)

		expect(cost_transcript.session_cwd(submodule)).toBe(submodule)
	})
})

// Derived from `lane_paths` so the fixture stays honest to the default-root shape the code derives.
const LANE = lane_paths.lane_directory(lane_paths.default_lane_root(MAIN), '1832')

// A fresh, empty home a from-main test writes lane transcripts into.
function empty_home(): string {
	return mkdtempSync(path.join(tmpdir(), 'cost-main-'))
}

// `lane_paths.lane_root` honors `JOSH_LANE_ROOT`; a blank value pins the default derivation these
// fixtures assume, and `vi.unstubAllEnvs` restores whatever the machine had. Registered by calling
// this from a describe so the two from-main suites share it without a second copy of the stub.
function with_default_lane_root(): void {
	beforeAll(() => {
		vi.stubEnv(lane_paths.LANE_ROOT_KEY, '')
	})

	afterAll(() => {
		vi.unstubAllEnvs()
	})
}

// The reverse of `session_cwd`: a report run from the main checkout must also search the lane
// checkouts filed under its lane root, or a lane run — the default execution form — reads
// `no transcript` (joshuafolkken/kit#1832).
describe('cost_transcript.transcript_directories from the main checkout', () => {
	with_default_lane_root()

	it('finds a lane run transcript filed under the lane root', () => {
		const home = empty_home()

		write_transcript(home, LANE, 'lane-run', usage_line('r1', 5))

		const directories = cost_transcript.transcript_directories(MAIN, home)
		const ids = cost_transcript.list_sessions_across(directories).map((file) => file.session_id)

		expect(directories).toContain(cost_transcript.transcript_directory(LANE, home))
		expect(ids).toStrictEqual(['lane-run'])
	})

	// A merged lane whose work tree `lane:close` pruned still resolves: the transcripts outlive the
	// checkout, so the scan is of the transcript store, not of a directory that may be gone.
	it('finds a lane whose checkout no longer exists', () => {
		const home = empty_home()
		const pruned = lane_paths.lane_directory(lane_paths.default_lane_root(MAIN), '1812')

		write_transcript(home, pruned, 'pruned-run', usage_line('r1', 5))

		expect(cost_transcript.transcript_directories(MAIN, home)).toContain(
			cost_transcript.transcript_directory(pruned, home),
		)
	})

	// A coincidental sibling like `.kit-lanes-backup` shares the lane-root prefix but its slug
	// remainder is not a lane issue number, so it must not be pulled into a main checkout's search.
	it('ignores a directory whose name only shares the lane-root prefix', () => {
		const home = empty_home()
		const sibling = '/Users/someone/Development/.kit-lanes-backup/1'

		write_transcript(home, sibling, 'foreign', usage_line('r1', 5))

		expect(cost_transcript.transcript_directories(MAIN, home)).not.toContain(
			cost_transcript.transcript_directory(sibling, home),
		)
	})
})

// joshuafolkken/kit#2236: the from-main direction is untouched — a main checkout still reaches its
// lane runs even when its own transcript is the larger one, the reverse of what a lane must not do.
describe('cost_transcript.transcript_directories sizing from the main checkout', () => {
	with_default_lane_root()

	it('includes the lane record even when the main checkout has a larger one', () => {
		const home = empty_home()

		write_transcript(home, MAIN, 'main-run', [usage_line('r1', 9), usage_line('r2', 9)].join('\n'))
		write_transcript(home, LANE, 'lane-run', usage_line('r3', 5))

		const ids = cost_transcript
			.list_sessions_across(cost_transcript.transcript_directories(MAIN, home))
			.map((file) => file.session_id)
			.toSorted((left, right) => left.localeCompare(right))

		expect(ids).toStrictEqual(['lane-run', 'main-run'])
	})
})
