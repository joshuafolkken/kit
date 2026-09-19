import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { delivered_rules_harness } from './delivered-rules-harness'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'
import { third_party_write } from './third-party-write'

// The `gh api` write to a repository we do not own, refused before the backlog count speaks
// (joshuafolkken/kit#2122). The core is tested against an injected owner; the delivery path runs in
// the kit checkout, whose owner is joshuafolkken.

const SESSION = 'joshuafolkken'
const resolve_session = (): string => SESSION
const THIRD_PARTY_COMMENT = 'gh api repos/sveltejs/svelte/issues/5/comments -f body=x'
const FIRST_PARTY_FILING = `gh api repos/${SESSION}/kit/issues -f title=x`
const ROW_ID = 'third-party-write'
const REASON = delivered_rules.THIRD_PARTY_WRITE_REASON

describe('writes_third_party — computed against an injected session owner', () => {
	it.each([
		['a filing', 'gh api repos/sveltejs/kit/issues -f title=x'],
		['a comment', 'gh api repos/other/repo/issues/5/comments -f body=x'],
		['a label delete', 'gh api -X DELETE repos/other/repo/issues/5/labels/x'],
	])('refuses %s to a third-party repository', (_name, command) => {
		expect(third_party_write.writes_third_party(command, resolve_session)).toBe(true)
	})

	it.each([
		['a first-party filing', FIRST_PARTY_FILING],
		['a third-party read', 'gh api repos/sveltejs/kit/issues/5 --jq .state'],
		['a non-repo write', 'gh api graphql -f query=x'],
		['a gh api quoted inside another command', 'echo gh api repos/sveltejs/kit/issues -f title=x'],
	])('is silent on %s', (_name, command) => {
		expect(third_party_write.writes_third_party(command, resolve_session)).toBe(false)
	})

	it('is silent when the session owner is unreadable', () => {
		expect(third_party_write.writes_third_party(THIRD_PARTY_COMMENT, () => undefined)).toBe(false)
	})
})

const harness = delivered_rules_harness.create_harness('rule-guard-3p-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

function claiming_ids(command: string): Array<string> {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: 'Bash', input: { command } }),
	).map((rule) => rule.id)
}

describe('third-party-write — delivered through the guard', () => {
	it('delivers on a third-party comment write', () => {
		expect(rule_delivery(payload_of('3p-comment', THIRD_PARTY_COMMENT), NOW_MS)).toBe(REASON)
	})

	it('is silent on a third-party read', () => {
		const command = 'gh api repos/sveltejs/svelte/issues/5 --jq .state'

		expect(rule_delivery(payload_of('3p-read', command), NOW_MS)).toBeUndefined()
	})

	it('is silent on a first-party comment write', () => {
		const command = `gh api repos/${SESSION}/kit/issues/5/comments -f body=x`

		expect(rule_delivery(payload_of('fp-comment', command), NOW_MS)).toBeUndefined()
	})

	it('is refused before wip-cap on a third-party filing', () => {
		const command = 'gh api repos/sveltejs/svelte/issues -f title=x'

		expect(rule_delivery(payload_of('3p-filing', command), NOW_MS)).toBe(REASON)
	})

	it('names the command and that it fires every time', () => {
		expect(REASON).toContain('pnpm josh repo:party')
		expect(REASON).toContain('every occurrence')
	})
})

describe('third-party-write — which rows claim a command', () => {
	// One refusal can leave a PreToolUse hook, so a non-filing third-party write must be claimed by
	// this row alone — the filing overlap with wip-cap/issue-scout/filing-cap is the intended one.
	it('claims a non-filing third-party write alone', () => {
		expect(claiming_ids(THIRD_PARTY_COMMENT)).toStrictEqual([ROW_ID])
	})

	it('does not claim a first-party filing', () => {
		expect(claiming_ids(FIRST_PARTY_FILING)).not.toContain(ROW_ID)
	})
})
