import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { piped_verification } from './piped-verification'
import { piped_verification_shapes } from './piped-verification-shapes'
import { rule_value_cache } from './rule-value-cache'
import { rule_value_cli } from './rule-value-cli'
import { rule_value_fixture } from './rule-value-fixture'
import { rule_value_runs, type RunSummary } from './rule-value-runs'

// A body read reaches the issue-comments trigger; the comments read in front of it is what keeping
// the rule looks like, so this run reaches and keeps it. The force push reaches `git-force`, which
// declares no `keeps`, so it reads unmeasured.
const COMMENTS_READ = 'gh api repos/o/r/issues/12/comments'
const BODY_READ = 'gh api repos/o/r/issues/12'
const FORCE_PUSH = 'git push --force origin main'
const GIT_FORCE = 'git-force'
const ISSUE_COMMENTS = 'issue-comments'
const TEMPORARY_PREFIX = 'rule-value-cli-'
const make_directory = temporary_directory()

interface FakeFile {
	text: string | undefined
	owner: string
}

function fake_file(text: string | undefined, owner: string): SessionFile {
	return { text, owner } as unknown as SessionFile
}

describe('rule_value_cli.render — one row per rule, or the no-targets answer', () => {
	it('prints the no-targets sentence when nothing measurable was found', () => {
		expect(rule_value_cli.render([])).toBe(rule_value_cli.NO_TARGETS)
	})

	it('prints exactly one line per measured rule', () => {
		const lines = rule_value_cli
			.render([[rule_value_fixture.session(COMMENTS_READ, BODY_READ, FORCE_PUSH)]])
			.split('\n')

		expect(lines).toHaveLength(delivered_rules.MEASURED_RULES.length)
	})
})

describe('rule_value_cli.row — the three readings a row can carry', () => {
	const kept = [[rule_value_fixture.session(COMMENTS_READ, BODY_READ, FORCE_PUSH)]]

	it('renders a reached, measurable rule as a percentage kept unaided', () => {
		const reading = rule_value_fixture.reading_for(ISSUE_COMMENTS, kept)

		expect(rule_value_cli.row(reading)).toContain('% unaided')
	})

	it('renders a rule with no keeps predicate as unmeasured, never as 0%', () => {
		const reading = rule_value_fixture.reading_for(GIT_FORCE, kept)

		expect(rule_value_cli.row(reading)).toContain(rule_value_cli.UNMEASURED)
		expect(rule_value_cli.row(reading)).not.toContain('%')
	})

	it('renders a measurable rule no run reached as unreached, distinct from 0%', () => {
		const reading = rule_value_fixture.reading_for(ISSUE_COMMENTS, [
			[rule_value_fixture.session('ls')],
		])

		expect(rule_value_cli.row(reading)).toContain(rule_value_cli.UNREACHED)
	})
})

describe('rule_value_cli.render_parts — the candidates beside the table', () => {
	it('carries no candidates when nothing measurable was found', () => {
		expect(rule_value_cli.render_parts([])).toStrictEqual({ table: rule_value_cli.NO_TARGETS })
	})

	it('keeps the table one line per rule and puts the candidates apart from it', () => {
		const parts = rule_value_cli.render_parts([[rule_value_fixture.session(COMMENTS_READ)]])

		expect(parts.table.split('\n')).toHaveLength(delivered_rules.MEASURED_RULES.length)
		expect(parts.candidates).toMatch(/^candidates:\n {2}retire .*\n {2}condense /u)
	})

	// joshuafolkken/kit#5266: the refusals of `piped-verification`, named by the filter that drew them.
	it('ends the candidates with the piped-verification refusals counted by shape', () => {
		const refusal = rule_value_fixture.answered_call(
			'pnpm josh gate | head -5',
			1,
			piped_verification.PIPED_VERIFICATION_REASON,
		)
		const { candidates = '' } = rule_value_cli.render_parts([[refusal]])

		expect(candidates.split('\n').at(-1)).toBe(
			`${piped_verification_shapes.HEADING} head 1 · grep 0 · awk|sed|tee 0 · chain 0 · other 0`,
		)
	})
})

// The two readers are spied on the real namespace, so the rest of the module — the roots and paths
// its transitive importers need — stays intact. The returned list records each file as it is read.
function spy_readers(): Array<SessionFile> {
	const read: Array<SessionFile> = []

	vi.spyOn(cost_transcript, 'owning_session_id').mockImplementation(
		(file) => (file as unknown as FakeFile).owner,
	)
	vi.spyOn(cost_transcript, 'read_optional').mockImplementation((file) => {
		read.push(file)

		return (file as unknown as FakeFile).text
	})

	return read
}

function sample_files(): Array<SessionFile> {
	return [
		fake_file('parent', 'run1'),
		fake_file('unit', 'run1'),
		fake_file(undefined, 'run1'),
		fake_file('other', 'run2'),
		fake_file(undefined, 'run3'),
	]
}

describe('rule_value_cli.group_by_run — a run owns every transcript that shares its id', () => {
	it('groups a session and its delegated unit under the one run without reading any text', () => {
		const read = spy_readers()
		const parent = fake_file('parent', 'run1')
		const unit = fake_file('unit', 'run1')
		const unreadable = fake_file(undefined, 'run1')
		const other = fake_file('other', 'run2')

		try {
			const runs = rule_value_cli.group_by_run([parent, unit, unreadable, other])

			expect([...runs]).toStrictEqual([
				['run1', [parent, unit, unreadable]],
				['run2', [other]],
			])
			expect(read).toHaveLength(0)
		} finally {
			vi.restoreAllMocks()
		}
	})
})

// The grouped runs summarized with no store, every run read.
function summarized(files: ReadonlyArray<SessionFile>): Array<RunSummary> {
	return rule_value_runs.summaries_of(rule_value_cli.group_by_run(files), stamped_memo.create())
}

describe('rule_value_cli.render_summaries — the grouped files read as the materialized runs', () => {
	it('reads each run whole and skips its unreadable files', () => {
		const read = spy_readers()
		const files = sample_files()

		try {
			const tables = rule_value_cli.render_summaries(summarized(files))

			expect(read).toStrictEqual(files)
			expect(tables).toStrictEqual(rule_value_cli.render_parts([['parent', 'unit'], ['other']]))
		} finally {
			vi.restoreAllMocks()
		}
	})
})

describe('rule_value_cli.render_summaries — the table of the grouped files', () => {
	it('renders the same table as the materialized runs it replaces', () => {
		spy_readers()
		const comments = fake_file(rule_value_fixture.session(COMMENTS_READ), 'run1')
		const body = fake_file(rule_value_fixture.session(BODY_READ, FORCE_PUSH), 'run1')
		const lone = fake_file(rule_value_fixture.session(FORCE_PUSH), 'run2')
		const materialized = [
			[
				rule_value_fixture.session(COMMENTS_READ),
				rule_value_fixture.session(BODY_READ, FORCE_PUSH),
			],
			[rule_value_fixture.session(FORCE_PUSH)],
		]

		try {
			const { table } = rule_value_cli.render_summaries(summarized([comments, body, lone]))

			expect(table).toBe(rule_value_cli.render(materialized))
		} finally {
			vi.restoreAllMocks()
		}
	})

	it('renders the no-targets sentence when every file is unreadable', () => {
		spy_readers()

		try {
			const { table } = rule_value_cli.render_summaries(summarized([fake_file(undefined, 'run1')]))

			expect(table).toBe(rule_value_cli.NO_TARGETS)
		} finally {
			vi.restoreAllMocks()
		}
	})
})

describe('rule_value_cli.run_rule_value — --prose audits the documents', () => {
	it('prints each prose rule with its class and source line, and writes no cache', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		try {
			writeFileSync(path.join(cwd, 'CLAUDE.md'), '- **Uncited rule.** Nothing cites it.\n')

			expect(rule_value_cli.run_rule_value(['--prose'], cwd)).toBe(0)
			expect(stdout).toHaveBeenCalledExactlyOnceWith(
				'文章だけ  CLAUDE.md:1  Uncited rule.\n\n強制あり 0 · 計測のみ 0 · 文章だけ 1\n',
			)
			expect(existsSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE))).toBe(false)
		} finally {
			vi.restoreAllMocks()
		}
	})
})

describe('rule_value_cli.run_rule_value — --refresh fills the loop-head cache', () => {
	it('writes the reading to the cache instead of stdout', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)
		// A fresh directory has no transcript directory, so the reading is the no-targets answer.
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		try {
			expect(rule_value_cli.run_rule_value(['--refresh'], cwd)).toBe(0)
			expect(stdout).not.toHaveBeenCalled()
			expect(
				readFileSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE), 'utf8'),
			).toBe(`${rule_value_cli.NO_TARGETS}\n`)
		} finally {
			vi.restoreAllMocks()
		}
	})

	it('keeps the per-run counts for the next refresh, versioned by the counting code', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)

		rule_value_cli.run_rule_value(['--refresh'], cwd)

		const stored = readFileSync(rule_value_cache.cache_path(cwd, 'rule-value-runs.json'), 'utf8')
		const version = rule_value_runs.version_of(rule_value_runs.counting_sources())

		expect(JSON.parse(stored)).toStrictEqual(expect.objectContaining({ version }))
	})

	it('prints the reading to stdout and leaves the cache alone without --refresh', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		try {
			expect(rule_value_cli.run_rule_value([], cwd)).toBe(0)
			expect(stdout).toHaveBeenCalledExactlyOnceWith(`${rule_value_cli.NO_TARGETS}\n`)
			expect(existsSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE))).toBe(false)
		} finally {
			vi.restoreAllMocks()
		}
	})
})

const CACHED_TABLE = 'issue-comments  reached 3  100% unaided  refused 0'

interface CachedRun {
	is_measured: boolean
	out: string
}

// A fresh directory holding a reading whose cache file was written `age_ms` ago.
function directory_with_cache(age_ms: number): string {
	const cwd = make_directory(TEMPORARY_PREFIX)
	const seconds = (Date.now() - age_ms) / MS_PER_SECOND

	rule_value_cache.store(CACHED_TABLE, cwd)
	utimesSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE), seconds, seconds)

	return cwd
}

// Run against that cache with the transcript listing spied, so a test reads whether it measured.
function run_with_cache(argv: ReadonlyArray<string>, age_ms: number): CachedRun {
	const cwd = directory_with_cache(age_ms)
	const out = new Array<string>()
	const listing = vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([])

	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
		out.push(String(chunk))

		return true
	})

	try {
		rule_value_cli.run_rule_value(argv, cwd)

		return { is_measured: listing.mock.calls.length > 0, out: out.join('') }
	} finally {
		vi.restoreAllMocks()
	}
}

describe('rule_value_cli.run_rule_value — a fresh cached reading is printed without measuring', () => {
	it('prints the cached table and when it was taken, without listing a transcript', () => {
		const { is_measured, out } = run_with_cache([], 0)

		expect(is_measured).toBe(false)
		expect(out).toContain(CACHED_TABLE)
		expect(out).toMatch(
			new RegExp(String.raw`${rule_value_cli.CACHED_NOTE} \d{4}-\d{2}-\d{2}T`, 'u'),
		)
	})

	it('measures when the cached reading is older than the refresh interval', () => {
		const { is_measured, out } = run_with_cache([], rule_value_cache.REFRESH_MS)

		expect(is_measured).toBe(true)
		expect(out).toBe(`${rule_value_cli.NO_TARGETS}\n`)
	})

	it('measures regardless of a fresh cache under --fresh', () => {
		const { is_measured, out } = run_with_cache(['--fresh'], 0)

		expect(is_measured).toBe(true)
		expect(out).not.toContain(rule_value_cli.CACHED_NOTE)
	})
})

describe('rule_value_cli.run_rule_value — the candidates stay out of the cache', () => {
	it('stores the table alone when a run was measured', () => {
		const cwd = make_directory(TEMPORARY_PREFIX)

		spy_readers()
		vi.spyOn(cost_transcript, 'list_sessions_across').mockReturnValue([
			fake_file(rule_value_fixture.session(COMMENTS_READ), 'run1'),
		])

		try {
			rule_value_cli.run_rule_value(['--refresh'], cwd)

			const cached = readFileSync(
				rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE),
				'utf8',
			)

			expect(cached).not.toContain('candidates:')
			expect(cached.trimEnd().split('\n')).toHaveLength(delivered_rules.MEASURED_RULES.length)
		} finally {
			vi.restoreAllMocks()
		}
	})
})
