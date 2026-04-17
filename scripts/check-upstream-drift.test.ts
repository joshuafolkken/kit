import { describe, expect, it } from 'vitest'
import { upstream_drift } from './check-upstream-drift'

const SAMPLE_SHA = 'deadbeef'
const SAMPLE_PATH = 'prompts/collaboration-workflow.md'
const EXPECTED_URL = `https://raw.githubusercontent.com/joshuafolkken/tasks/${SAMPLE_SHA}/${SAMPLE_PATH}`
const SHA_PATTERN = /^[\da-f]{40}$/u

describe('upstream_drift.build_raw_url', () => {
	it('builds a raw URL for the given sha and file path', () => {
		expect(upstream_drift.build_raw_url(SAMPLE_SHA, SAMPLE_PATH)).toBe(EXPECTED_URL)
	})

	it('encodes special characters in the path', () => {
		const url = upstream_drift.build_raw_url('sha', 'dir/with space.ts')

		expect(url).toContain('dir/with%20space.ts')
	})
})

describe('upstream_drift.classify', () => {
	it('returns match when local and upstream contents are identical', () => {
		expect(upstream_drift.classify('hello\n', 'hello\n')).toBe('match')
	})

	it('returns drifted when contents differ', () => {
		expect(upstream_drift.classify('a', 'b')).toBe('drifted')
	})

	it('returns missing_local when local is absent', () => {
		expect(upstream_drift.classify(undefined, 'upstream')).toBe('missing_local')
	})

	it('returns missing_upstream when upstream is absent', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined
		expect(upstream_drift.classify('local', undefined)).toBe('missing_upstream')
	})
})

describe('upstream_drift.format_report', () => {
	it('formats an all-clear report when no drift found', () => {
		const report = upstream_drift.format_report([])

		expect(report).toContain('No drift detected')
	})

	it('lists drifted paths grouped by status', () => {
		const report = upstream_drift.format_report([
			{ path: 'a.md', status: 'drifted' },
			{ path: 'b.ts', status: 'missing_local' },
			{ path: 'c.ts', status: 'missing_upstream' },
		])

		expect(report).toContain('a.md')
		expect(report).toContain('b.ts')
		expect(report).toContain('c.ts')
		expect(report).toContain('drifted')
	})
})

describe('upstream_drift.SYNCED_FILES', () => {
	it('includes the canonical collaboration workflow prompt', () => {
		expect(upstream_drift.SYNCED_FILES).toContain(SAMPLE_PATH)
	})

	it('includes all three AI agent instruction files', () => {
		expect(upstream_drift.SYNCED_FILES).toEqual(
			expect.arrayContaining(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']),
		)
	})

	it('has no duplicate entries', () => {
		const unique = new Set(upstream_drift.SYNCED_FILES)

		expect(unique.size).toBe(upstream_drift.SYNCED_FILES.length)
	})
})

describe('upstream_drift.TASKS_UPSTREAM_SHA', () => {
	it('is a 40-character hex SHA', () => {
		expect(upstream_drift.TASKS_UPSTREAM_SHA).toMatch(SHA_PATTERN)
	})
})
