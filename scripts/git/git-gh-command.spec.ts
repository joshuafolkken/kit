import { describe, expect, it } from 'vitest'
import { git_gh_command } from './git-gh-command'
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
