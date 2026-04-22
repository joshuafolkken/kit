import { describe, expect, it } from 'vitest'
import { git_gh_command, parse_pr_state_string } from './git-gh-command'
import { PR_CHECKS_WATCH_TIMEOUT_MS } from './git-pr-checks-watch'

const MIN_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 300_000

describe('git_gh_command', () => {
	it('exposes pr_merge as a callable function', () => {
		expect(typeof git_gh_command.pr_merge).toBe('function')
	})
})

describe('PR_CHECKS_WATCH_TIMEOUT_MS', () => {
	it('is defined and within a reasonable range', () => {
		expect(PR_CHECKS_WATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(MIN_TIMEOUT_MS)
		expect(PR_CHECKS_WATCH_TIMEOUT_MS).toBeLessThanOrEqual(MAX_TIMEOUT_MS)
	})
})

describe('parse_pr_state_string', () => {
	it('returns undefined for empty string', () => {
		expect(parse_pr_state_string('')).toBeUndefined()
	})

	it('returns undefined for whitespace-only string', () => {
		expect(parse_pr_state_string('   ')).toBeUndefined()
	})

	it('returns undefined for empty quoted string', () => {
		expect(parse_pr_state_string('""')).toBeUndefined()
	})

	it('strips surrounding double quotes', () => {
		expect(parse_pr_state_string('"https://github.com/org/repo/pull/1"')).toBe(
			'https://github.com/org/repo/pull/1',
		)
	})

	it('returns unquoted value as-is', () => {
		expect(parse_pr_state_string('OPEN')).toBe('OPEN')
	})

	it('trims surrounding whitespace before processing', () => {
		expect(parse_pr_state_string('  "main"  ')).toBe('main')
	})
})
