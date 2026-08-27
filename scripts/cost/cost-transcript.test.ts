import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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

function sessions_in(home: string): ReturnType<typeof cost_transcript.list_sessions> {
	return cost_transcript.list_sessions(cost_transcript.transcript_directory(CWD, home))
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
		const absent = path.join(tmpdir(), 'cost-absent')

		expect(cost_transcript.list_sessions(absent)).toStrictEqual([])
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
			path: path.join(tmpdir(), 'cost-absent-file'),
			modified_ms: 0,
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
