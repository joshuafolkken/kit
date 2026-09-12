import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cost_transcript } from './cost-transcript'

const CWD = '/Users/someone/Development/kit'
const ASSISTANT = 'assistant'

function usage_line(request_id: string, output_tokens: number): string {
	return JSON.stringify({
		type: ASSISTANT,
		requestId: request_id,
		gitBranch: 'main',
		message: { model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens } },
	})
}

// A home directory holding one project's transcripts, so the reader is exercised against real files
// rather than a mocked `fs` — the failure this command must not have is reading nothing and calling
// it zero, and only a real path can produce that.
function make_home(content: string): string {
	const home = mkdtempSync(path.join(tmpdir(), 'cost-'))
	const directory = cost_transcript.transcript_directory(CWD, home)

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `one${cost_transcript.TRANSCRIPT_EXTENSION}`), content)

	return home
}

// A path that is guaranteed not to exist, named under a directory this run created. A fixed name
// under `os.tmpdir()` would be shared with every other unit suite on the machine, so whether it is
// absent would depend on what those suites happen to be doing (joshuafolkken/kit#1517).
const ABSENT_ROOT = mkdtempSync(path.join(tmpdir(), 'cost-absent-'))

function absent_path(name: string): string {
	return path.join(ABSENT_ROOT, name)
}

afterAll(() => {
	rmSync(ABSENT_ROOT, { recursive: true, force: true })
})

// A linked work tree as git leaves one: its `.git` is a *file* naming the main checkout's worktree
// registration, which is what says where the session's transcripts are actually filed.
function make_worktree(gitdir: string): string {
	const root = mkdtempSync(path.join(tmpdir(), 'cost-worktree-'))

	writeFileSync(path.join(root, '.git'), `gitdir: ${gitdir}\n`)

	return root
}

function sessions_in(home: string): ReturnType<typeof cost_transcript.list_sessions> {
	return cost_transcript.list_sessions(cost_transcript.transcript_directory(CWD, home))
}

// A delegated unit's transcript, written where Claude Code writes one: a `subagents` directory
// under the session that delegated it, rather than beside that session's own file.
function write_unit(home: string, session_name: string, agent_name: string): void {
	const directory = cost_transcript.unit_directory(
		cost_transcript.transcript_directory(CWD, home),
		session_name,
	)

	mkdirSync(directory, { recursive: true })
	writeFileSync(
		path.join(directory, `${agent_name}${cost_transcript.TRANSCRIPT_EXTENSION}`),
		usage_line('unit', 3),
	)
}

describe('cost_transcript.project_slug', () => {
	it('turns a working directory into the slug Claude Code names the folder with', () => {
		expect(cost_transcript.project_slug(CWD)).toBe('-Users-someone-Development-kit')
	})

	it('replaces dots as well as separators', () => {
		expect(cost_transcript.project_slug('/a/b.c')).toBe('-a-b-c')
	})

	// Verified against this machine's transcript directory: a working directory named
	// `slug_probe.dir` produced `slug-probe-dir`. Replacing only `/` and `.` left every project
	// whose path holds an underscore resolving to a directory that does not exist, and the command
	// then reported "no transcripts found" for a project whose transcripts were sitting there.
	it('replaces an underscore, which a real project path routinely contains', () => {
		expect(cost_transcript.project_slug('/a/slug_probe.dir')).toBe('-a-slug-probe-dir')
	})

	it('replaces a space', () => {
		expect(cost_transcript.project_slug('/a/my project')).toBe('-a-my-project')
	})

	// Hyphens survive: `Development/joshuafolkken-com` is a real directory here and keeps its own.
	it('keeps hyphens and letter case', () => {
		expect(cost_transcript.project_slug('/Users/a/joshuafolkken-com')).toBe(
			'-Users-a-joshuafolkken-com',
		)
	})
})

describe('cost_transcript.list_sessions', () => {
	it('finds the project transcripts', () => {
		const home = make_home(usage_line('r1', 5))

		expect(sessions_in(home)).toHaveLength(1)
	})

	it('returns nothing for a project that has none, rather than throwing', () => {
		const absent = absent_path('project')

		expect(cost_transcript.list_sessions(absent)).toStrictEqual([])
	})

	// `epicrun` and `queue` run each child in a delegated unit, and `gate-fix` / `survey` delegate one
	// step of a run. The unit writes to `<session-id>/subagents/`, so a listing of the project
	// directory alone finds the parent waiting and none of the work (joshuafolkken/kit#1285).
	it('finds a delegated unit transcript in the session subdirectory', () => {
		const home = make_home(usage_line('r1', 5))

		write_unit(home, 'one', 'agent-a1')

		expect(sessions_in(home)).toHaveLength(2)
	})

	// The unit is part of a run rather than a run of its own, and both readers need to know which it
	// is: `josh time` must not count a unit's work twice against the parent's wait for it, and
	// `josh cost`'s no-argument scope means the session, not one of its units.
	it('marks a delegated unit as such and a session as not', () => {
		const home = make_home(usage_line('r1', 5))

		write_unit(home, 'one', 'agent-a1')

		const found = sessions_in(home)

		expect(found.filter((file) => file.is_delegated)).toHaveLength(1)
		expect(found.filter((file) => !file.is_delegated)).toHaveLength(1)
	})

	// An agent id alone reads as a session of its own, and `--session` has to be able to name a unit
	// unambiguously.
	it('qualifies a unit id with the session that delegated it', () => {
		const home = make_home(usage_line('r1', 5))

		write_unit(home, 'one', 'agent-a1')

		const unit = sessions_in(home).find((file) => file.is_delegated)

		expect(unit?.session_id).toBe('one/agent-a1')
	})

	// The guarantee for a project that never delegated: nothing about its listing changes.
	it('lists only the session file when no unit directory exists', () => {
		const found = sessions_in(make_home(usage_line('r1', 5)))

		expect(found.map((file) => file.session_id)).toStrictEqual(['one'])
	})
})

const MAIN = CWD

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

	// The joshuafolkken/kit#1617 case, kept working: the session stayed in the main checkout and only
	// prefixed its commands with the lane path, so its transcript is under the main slug.
	it('finds a transcript filed under the main checkout slug', () => {
		const { home, lane } = lane_home()

		write_transcript(home, MAIN, 'main-run', usage_line('r1', 5))

		expect(ids_for(home, lane)).toStrictEqual(['main-run'])
	})

	it('unions transcripts found under both slugs', () => {
		const { home, lane } = lane_home()

		write_transcript(home, lane, 'lane-run', usage_line('r1', 5))
		write_transcript(home, MAIN, 'main-run', usage_line('r2', 5))

		expect(ids_for(home, lane).toSorted((left, right) => left.localeCompare(right))).toStrictEqual([
			'lane-run',
			'main-run',
		])
	})

	// A session file lives under one slug, but a defensive dedupe keeps a merge from doubling what it
	// measured should the same id ever surface under both.
	it('counts a session found under both slugs once', () => {
		const { home, lane } = lane_home()

		write_transcript(home, lane, 'shared', usage_line('r1', 5))
		write_transcript(home, MAIN, 'shared', usage_line('r1', 5))

		expect(cost_transcript.list_sessions_across(directories_of(home, lane))).toHaveLength(1)
	})

	it('returns nothing when neither slug has a transcript', () => {
		const { home, lane } = lane_home()

		expect(cost_transcript.list_sessions_across(directories_of(home, lane))).toStrictEqual([])
	})
})

describe('cost_transcript.searched_directories', () => {
	it('reports both candidate slugs, each absent when nothing was written', () => {
		const { home, lane } = lane_home()

		const searched = cost_transcript.searched_directories(directories_of(home, lane))

		expect(searched).toHaveLength(2)
		expect(searched.every((directory) => !directory.exists)).toBe(true)
	})

	it('distinguishes an existing-but-empty slug from an absent one', () => {
		const { home, lane } = lane_home()

		mkdirSync(cost_transcript.transcript_directory(MAIN, home), { recursive: true })

		const searched = cost_transcript.searched_directories(directories_of(home, lane))
		const lane_directory = cost_transcript.transcript_directory(lane, home)
		const main_directory = cost_transcript.transcript_directory(MAIN, home)

		expect(searched.find((directory) => directory.path === lane_directory)?.exists).toBe(false)
		expect(searched.find((directory) => directory.path === main_directory)?.exists).toBe(true)
	})
})

describe('cost_transcript.missing_message', () => {
	it('gives an absent directory a different reason from an existing empty one', () => {
		const lines = cost_transcript.missing_message(
			[
				{ path: '/a/lane', exists: false },
				{ path: '/a/main', exists: true },
			],
			undefined,
		)

		expect(lines.join('\n')).toContain('/a/lane — no such directory')
		expect(lines.join('\n')).toContain('/a/main — no transcripts here')
	})

	it('names the session it looked for', () => {
		const lines = cost_transcript.missing_message([{ path: '/a/main', exists: true }], 'abc')

		expect(lines[0]).toContain('No transcript named abc')
	})
})

// Which of a listing `josh cost` means by "the run that just finished". The unit almost always
// writes the newer file — the parent is waiting while it works — so the head of the listing would
// answer a no-argument run with one child of a batch.
describe('cost_transcript.latest_own_index', () => {
	const own = { session_id: 'a', path: 'a', modified_ms: 2, is_delegated: false }
	const unit = { session_id: 'a/agent-1', path: 'b', modified_ms: 3, is_delegated: true }

	it('skips a delegated unit that sorted ahead of the session', () => {
		expect(cost_transcript.latest_own_index([unit, own])).toBe(1)
	})

	it('takes the head when every transcript is a session of its own', () => {
		expect(cost_transcript.latest_own_index([own, own])).toBe(0)
	})

	// `--session <parent>/agent-<id>` narrows the listing to one unit, and answering "no transcript"
	// for a transcript that was found would refuse a scope the user named.
	it('falls back to a unit when the listing holds nothing else', () => {
		expect(cost_transcript.latest_own_index([unit])).toBe(0)
	})
})

describe('cost_transcript.read_session', () => {
	it('reads the requests out of a transcript', () => {
		const [file] = sessions_in(make_home([usage_line('r1', 5), usage_line('r2', 7)].join('\n')))
		const session = file === undefined ? undefined : cost_transcript.read_session(file)

		expect(session?.records).toHaveLength(2)
		expect(session?.is_readable).toBe(true)
	})

	it('gives each unreadable session its own records array', () => {
		const missing = {
			session_id: 'x',
			path: absent_path('missing.jsonl'),
			modified_ms: 0,
			is_delegated: false,
		}
		const first = cost_transcript.read_session(missing)
		const second = cost_transcript.read_session(missing)

		expect(first.records).not.toBe(second.records)
		expect(first.is_readable).toBe(false)
	})

	it('collapses the several lines one request was written as', () => {
		const [file] = sessions_in(make_home([usage_line('r1', 5), usage_line('r1', 5)].join('\n')))

		expect(file === undefined ? [] : cost_transcript.read_session(file).records).toHaveLength(1)
	})
})

describe('cost_transcript.tally', () => {
	it('counts the lines it could not read instead of dropping them', () => {
		const tallied = cost_transcript.tally(
			['{ not json', JSON.stringify({ type: ASSISTANT, message: {} }), usage_line('r1', 5)].join(
				'\n',
			),
		)

		expect(tallied.malformed_lines).toBe(1)
		expect(tallied.no_usage_lines).toBe(1)
		expect(tallied.records).toHaveLength(1)
	})

	it('does not count ordinary non-assistant lines as missing data', () => {
		const tallied = cost_transcript.tally(JSON.stringify({ type: 'user' }))

		expect(tallied.malformed_lines).toBe(0)
		expect(tallied.no_usage_lines).toBe(0)
	})
})

// The store is keyed on the *session's* working directory, and a lane is a checkout no session ever
// ran in: `epicrun` gives each child a linked work tree and the child prefixes every command with it,
// while the Claude session stays in the main checkout. So `pnpm josh time` invoked from a lane asked
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
