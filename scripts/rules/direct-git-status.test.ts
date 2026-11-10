import { delivered_rules_harness } from '#tools/rules/delivered-rules-harness'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { direct_git_status } from './direct-git-status'
import { poll_loop } from './poll-loop'

// joshuafolkken/kit#7144: a hand-typed `git status` in a form `pnpm josh tree:status` covers is pointed
// there once per run; another tree, a pathspec or another flag is a legitimate read and stays silent.

const harness = delivered_rules_harness.create_harness('rule-guard-git-status-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000
const LATER_MS = NOW_MS + 1000
const SHORT_STATUS = 'git status --short'
const TREE_STATUS = 'pnpm josh tree:status'

beforeEach(() => {
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

describe('direct_git_status.is_covered_status — refuses', () => {
	it.each([
		'git status',
		SHORT_STATUS,
		'git status -s',
		'git status -sb',
		'git status --short --branch',
		'git status --porcelain',
		'command git status -s',
		'pnpm josh ms && git status --short',
		"sh -c 'git status --short'",
	])('refuses %j', (command) => {
		expect(direct_git_status.is_covered_status(command)).toBe(true)
	})
})

describe('direct_git_status.is_covered_status — is silent on', () => {
	it.each([
		TREE_STATUS,
		'git -C ../other status --short',
		'git --git-dir=.git status',
		'git status -- src',
		'git status --ignored',
		'git status -uno',
		'git status --porcelain=v2',
		'git diff --stat',
		'echo "git status --short"',
		"git commit -m 'git status'",
	])('is silent on %j', (command) => {
		expect(direct_git_status.is_covered_status(command)).toBe(false)
	})
})

describe('direct-git-status — delivered through the guard', () => {
	it('refuses the first `git status` of a run and lets the reissue through', () => {
		const payload = payload_of('git-status-once', SHORT_STATUS)

		expect(delivered_rules.delivery(payload, NOW_MS)).toBe(
			direct_git_status.DIRECT_GIT_STATUS_REASON,
		)
		expect(delivered_rules.delivery(payload, LATER_MS)).toBeUndefined()
	})

	it('leaves a polling loop over `git status` to poll-loop alone', () => {
		const command = 'until git status --short | grep -q x; do sleep 5; done'

		expect(delivered_rules.delivery(payload_of('git-status-poll', command), NOW_MS)).toBe(
			poll_loop.POLL_LOOP_REASON,
		)
	})

	it('points the refusal at tree:status', () => {
		expect(direct_git_status.DIRECT_GIT_STATUS_REASON).toContain(TREE_STATUS)
	})
})
