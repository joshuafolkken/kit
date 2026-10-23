import { delivered_rules_harness } from '#tools/rules/delivered-rules-harness'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { third_party_write } from './third-party-write'

// The `gh api` write to a repository we do not own, refused before the backlog count speaks
// (joshuafolkken/kit#2122). The core is tested against an injected owner; the delivery path runs in
// the kit checkout, whose owner is joshuafolkken.

const SESSION = 'joshuafolkken'

function resolve_session(): string {
	return SESSION
}

const THIRD_PARTY_COMMENT = 'gh api repos/sveltejs/svelte/issues/5/comments -f body=x'
const FIRST_PARTY_FILING = `gh api repos/${SESSION}/kit/issues -f title=x`
// `gh` expands `{owner}` / `{repo}` to the current repository, so this is a first-party write
// (joshuafolkken/kit#3188).
const PLACEHOLDER_LABEL = "gh api repos/{owner}/{repo}/issues/1/labels -f 'labels[]=x'"
const ROW_ID = 'third-party-write'
const REASON = delivered_rules.THIRD_PARTY_WRITE_REASON

describe('writes_third_party — computed against an injected session owner', () => {
	it.each([
		['a filing', 'gh api repos/sveltejs/kit/issues -f title=x'],
		['a comment', 'gh api repos/other/repo/issues/5/comments -f body=x'],
		['a label delete', 'gh api -X DELETE repos/other/repo/issues/5/labels/x'],
		[
			'a write to another owner with the repo placeholder',
			'gh api repos/other/{repo}/issues -f title=x',
		],
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

describe('writes_third_party — the owner placeholder, against injected candidate remotes', () => {
	it.each([
		['the {owner} placeholder', PLACEHOLDER_LABEL],
		['the legacy :owner placeholder', 'gh api repos/:owner/:repo/issues/1/labels -f labels[]=x'],
	])('is silent on %s when every candidate remote is first-party', (_name, command) => {
		const is_third_party = third_party_write.writes_third_party(command, resolve_session, () => [
			SESSION,
		])

		expect(is_third_party).toBe(false)
	})

	it('refuses the placeholder in a fork checkout whose upstream is another owner', () => {
		const is_third_party = third_party_write.writes_third_party(
			PLACEHOLDER_LABEL,
			resolve_session,
			() => [SESSION, 'sveltejs'],
		)

		expect(is_third_party).toBe(true)
	})
})

describe('writes_third_party — the owner placeholder it cannot resolve', () => {
	it('refuses the placeholder when a candidate remote owner is unreadable', () => {
		const is_third_party = third_party_write.writes_third_party(
			PLACEHOLDER_LABEL,
			resolve_session,
			() => [SESSION, undefined],
		)

		expect(is_third_party).toBe(true)
	})

	it.each([
		['a directory change', `cd ../svelte && ${PLACEHOLDER_LABEL}`],
		['an exported GH_REPO', `export GH_REPO=sveltejs/svelte && ${PLACEHOLDER_LABEL}`],
		['an assigned GH_REPO', `GH_REPO=sveltejs/svelte; ${PLACEHOLDER_LABEL}`],
	])('refuses the placeholder after %s earlier in the line', (_name, command) => {
		const is_third_party = third_party_write.writes_third_party(command, resolve_session, () => [
			SESSION,
		])

		expect(is_third_party).toBe(true)
	})
})

// The bypasses joshuafolkken/kit#4659 closes: a GraphQL write names no repository the guard can read,
// and a `gh <group> <action> -R` write names its repository in the selector, not an api path.
describe('writes_third_party — a GraphQL write it cannot place', () => {
	it.each([
		[
			'an inline mutation',
			'gh api graphql -f query=\'mutation { addComment(input: {subjectId: "x", body: "y"}) { clientMutationId } }\'',
		],
		[
			'a multi-line mutation',
			'gh api graphql -f query=\'\nmutation {\n  addComment(input: {subjectId: "x"}) { clientMutationId }\n}\'',
		],
		['a query held in a variable', 'Q=$(cat m.graphql); gh api graphql -f query="$Q"'],
		['an unquoted expanded query', 'gh api graphql -f query=$Q'],
	])('refuses %s whatever the session owner', (_name, command) => {
		expect(third_party_write.writes_third_party(command, () => undefined)).toBe(true)
	})

	it.each([
		['a GraphQL query', "gh api graphql -f query='{ viewer { login } }'"],
		[
			'a single-quoted query with variables',
			"gh api graphql -f query='query($o: String!) { repository(owner: $o) { id } }' -f o=x",
		],
		// `pr-merge` refuses these and names the merge; one refusal leaves the hook.
		[
			'a merge mutation',
			"gh api graphql -f query='mutation { mergePullRequest(input: {}) { x } }'",
		],
		['a GraphQL body read from a file', 'gh api graphql -F query=@comment.graphql'],
	])('leaves %s to its own row', (_name, command) => {
		expect(third_party_write.writes_third_party(command, resolve_session)).toBe(false)
	})
})

describe('writes_third_party — a gh write with a repository selector', () => {
	it.each([
		['pr create', 'gh pr create -R sveltejs/svelte --title t --body b'],
		['issue comment', 'gh issue comment 5 --repo sveltejs/svelte --body b'],
		['a host-prefixed selector', 'gh issue close 5 -R github.com/sveltejs/svelte'],
		['an unreadable selector', 'gh issue comment 5 -R "$REPO" --body b'],
		['an inline GH_REPO selector', 'GH_REPO=sveltejs/svelte gh issue comment 5 -b x'],
		['an exported GH_REPO selector', 'export GH_REPO=sveltejs/svelte; gh pr create -t t -b b'],
	])('refuses %s against another owner', (_name, command) => {
		expect(third_party_write.writes_third_party(command, resolve_session)).toBe(true)
	})

	it.each([
		['pr create to the session owner', `gh pr create -R ${SESSION}/kit --title t --body b`],
		['pr view of another owner', 'gh pr view 5 -R sveltejs/svelte'],
		['a variable get of another owner', 'gh variable get NAME -R sveltejs/svelte'],
		['an attestation verify of another owner', 'gh attestation verify a.tgz -R sveltejs/svelte'],
	])('passes %s', (_name, command) => {
		expect(third_party_write.writes_third_party(command, resolve_session)).toBe(false)
	})
})

const harness = delivered_rules_harness.create_harness('rule-guard-3p-')
const { payload_of } = harness
const NOW_MS = 1_700_000_000_000

beforeEach(() => {
	process.env[delivered_rules.SWITCH_ENV_KEY] = ''
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
		expect(delivered_rules.delivery(payload_of('3p-comment', THIRD_PARTY_COMMENT), NOW_MS)).toBe(
			REASON,
		)
	})

	it('is silent on a third-party read', () => {
		const command = 'gh api repos/sveltejs/svelte/issues/5 --jq .state'

		expect(delivered_rules.delivery(payload_of('3p-read', command), NOW_MS)).toBeUndefined()
	})

	it('is silent on a first-party comment write', () => {
		const command = `gh api repos/${SESSION}/kit/issues/5/comments -f body=x`

		expect(delivered_rules.delivery(payload_of('fp-comment', command), NOW_MS)).toBeUndefined()
	})

	it('is silent on a placeholder label write', () => {
		expect(
			delivered_rules.delivery(payload_of('fp-placeholder', PLACEHOLDER_LABEL), NOW_MS),
		).toBeUndefined()
	})

	it('is refused before wip-cap on a third-party filing', () => {
		const command = 'gh api repos/sveltejs/svelte/issues -f title=x'

		expect(delivered_rules.delivery(payload_of('3p-filing', command), NOW_MS)).toBe(REASON)
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
