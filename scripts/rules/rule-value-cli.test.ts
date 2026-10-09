import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_value_cache } from './rule-value-cache'
import { rule_value_cli } from './rule-value-cli'
import { rule_value_fixture } from './rule-value-fixture'

// A body read reaches the issue-comments trigger; the comments read in front of it is what keeping
// the rule looks like, so this run reaches and keeps it. The filing reaches the filing cap, which
// declares no `keeps`, so it reads unmeasured.
const COMMENTS_READ = 'gh api repos/o/r/issues/12/comments'
const BODY_READ = 'gh api repos/o/r/issues/12'
const FILING = 'pnpm josh issue:file "x" --body-file b.md --depth 1'
const FILING_CAP = 'filing-cap'
const ISSUE_COMMENTS = 'issue-comments'
const TEMPORARY_PREFIX = 'rule-value-cli-'

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
			.render([[rule_value_fixture.session(COMMENTS_READ, BODY_READ, FILING)]])
			.split('\n')

		expect(lines).toHaveLength(delivered_rules.MEASURED_RULES.length)
	})
})

describe('rule_value_cli.row — the three readings a row can carry', () => {
	const kept = [[rule_value_fixture.session(COMMENTS_READ, BODY_READ, FILING)]]

	it('renders a reached, measurable rule as a percentage kept unaided', () => {
		const reading = rule_value_fixture.reading_for(ISSUE_COMMENTS, kept)

		expect(rule_value_cli.row(reading)).toContain('% unaided')
	})

	it('renders a rule with no keeps predicate as unmeasured, never as 0%', () => {
		const reading = rule_value_fixture.reading_for(FILING_CAP, kept)

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

describe('rule_value_cli.group_by_run — a run owns every transcript that shares its id', () => {
	it('groups a session and its delegated unit under the one run, skipping unreadable files', () => {
		// The two readers are spied on the real namespace, so the rest of the module — the roots and
		// paths its transitive importers need — stays intact.
		vi.spyOn(cost_transcript, 'read_optional').mockImplementation(
			(file) => (file as unknown as FakeFile).text,
		)
		vi.spyOn(cost_transcript, 'owning_session_id').mockImplementation(
			(file) => (file as unknown as FakeFile).owner,
		)
		const files = [
			fake_file('parent', 'run1'),
			fake_file('unit', 'run1'),
			fake_file(undefined, 'run1'),
			fake_file('other', 'run2'),
		]

		const runs = rule_value_cli.group_by_run(files)

		expect(runs.get('run1')).toStrictEqual(['parent', 'unit'])
		expect(runs.get('run2')).toStrictEqual(['other'])
	})
})

describe('rule_value_cli.run_rule_value — --refresh fills the loop-head cache', () => {
	it('writes the reading to the cache instead of stdout', () => {
		const cwd = mkdtempSync(path.join(tmpdir(), TEMPORARY_PREFIX))
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
			rmSync(cwd, { recursive: true, force: true })
		}
	})

	it('prints the reading to stdout and leaves the cache alone without --refresh', () => {
		const cwd = mkdtempSync(path.join(tmpdir(), TEMPORARY_PREFIX))
		const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		try {
			expect(rule_value_cli.run_rule_value([], cwd)).toBe(0)
			expect(stdout).toHaveBeenCalledExactlyOnceWith(`${rule_value_cli.NO_TARGETS}\n`)
			expect(existsSync(rule_value_cache.cache_path(cwd, rule_value_cache.CACHE_FILE))).toBe(false)
		} finally {
			vi.restoreAllMocks()
			rmSync(cwd, { recursive: true, force: true })
		}
	})
})
