import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cost_transcript } from './cost-transcript'
import { cost_transcript_fixture } from './cost-transcript-fixture'

// The lane-direction suites and their fixtures live in `cost-transcript-lanes.test.ts`
// (joshuafolkken/kit#2236); this file keeps the slug, listing and parsing suites, sharing the base
// fixtures through `cost_transcript_fixture`.
const { CWD, ASSISTANT, usage_line } = cost_transcript_fixture

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
	const own = { session_id: 'a', path: 'a', modified_ms: 2, is_delegated: false, depth: 0 }
	const unit = { session_id: 'a/agent-1', path: 'b', modified_ms: 3, is_delegated: true, depth: 1 }

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
			depth: 0,
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
