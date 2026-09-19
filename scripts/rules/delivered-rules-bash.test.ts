import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { delivered_rules_harness } from './delivered-rules-harness'
import { rule_delivery, SWITCH_ENV_KEY } from './rule-guard'

// joshuafolkken/kit#2120: the three Bash-string rows fire through the real delivery path, and stay
// silent on the safe forms — the doctrine that a relocation which does not fire is not a relocation.
// Their triggers also claim disjoint commands, so no two rows deliver on one call, which only one
// refusal per `PreToolUse` hook makes load-bearing.

const harness = delivered_rules_harness.create_harness('rule-guard-bash-')
const { payload_of, work } = harness
const NOW_MS = 1_700_000_000_000
const ONE_RULE = 1
// The literals each used both in an it.each row and in the exactly-one-rule assertion below.
const CLAIMED_TITLE = 'is claimed by exactly one rule'
const FORCE_CLUSTER = 'git push -uf origin main'
const STASH_POP = 'git stash pop'

// A real file under the work directory, so the heredoc-to-existing-file branch is exercised through the
// live `existsSync` rather than an injected stub — the one shape whose refusal depends on the filesystem.
const EXISTING_TARGET = path.join(work, 'target.md')

writeFileSync(EXISTING_TARGET, 'existing body\n')

beforeEach(() => {
	process.env[SWITCH_ENV_KEY] = ''
})

afterAll(() => {
	harness.cleanup()
})

// The delivered reason, or undefined, for a command run once through the guard on a fresh transcript.
function delivered_for(name: string, command: string): string | undefined {
	return rule_delivery(payload_of(name, command), NOW_MS)
}

// How many rows' triggers claim a command. One refusal can leave a `PreToolUse` hook, so a command two
// rows claimed would drop one silently.
function rules_claiming(command: string): number {
	return delivered_rules.DELIVERED_RULES.filter((rule) =>
		rule.is_trigger({ name: 'Bash', input: { command } }),
	).length
}

describe('git-force — the force push and branch delete the deny glob misses', () => {
	it.each([
		['cluster', FORCE_CLUSTER],
		['prefix', 'git -C /repo push --force'],
		['colon', 'git push origin :branch'],
		['branch', 'git branch -D old'],
	])('delivers on the %s spelling', (_name, command) => {
		expect(delivered_for(`gf-${_name}`, command)).toBe(delivered_rules.GIT_FORCE_REASON)
	})

	it.each([
		['push', 'git push origin main'],
		['upstream', 'git push -u origin main'],
		['branch', 'git branch feature'],
	])('is silent on an ordinary %s', (_name, command) => {
		expect(delivered_for(`gfs-${_name}`, command)).toBeUndefined()
	})

	it(CLAIMED_TITLE, () => {
		expect(rules_claiming(FORCE_CLUSTER)).toBe(ONE_RULE)
	})
})

describe('worktree-mutation — the discard and stash the deny list does not cover', () => {
	it.each([
		['checkout', 'git checkout -- src/app.ts'],
		['restore', 'git restore src/app.ts'],
		['stash', 'git stash'],
		['pop', STASH_POP],
	])('delivers on %s', (_name, command) => {
		expect(delivered_for(`wt-${_name}`, command)).toBe(delivered_rules.WORKTREE_MUTATION_REASON)
	})

	it.each([
		['authorized push', 'git stash push -u -m "fullrun: paused #1 for prerequisite #2"'],
		['list', 'git stash list'],
		['node route', 'pnpm josh stash:pop "fullrun: paused #1 for prerequisite #2"'],
		['index restore', 'git restore --staged src/app.ts'],
	])('is silent on %s', (_name, command) => {
		expect(delivered_for(`wts-${_name}`, command)).toBeUndefined()
	})

	it(CLAIMED_TITLE, () => {
		expect(rules_claiming(STASH_POP)).toBe(ONE_RULE)
	})
})

describe('file-body — the inline body write the deny list cannot see', () => {
	it('delivers on a heredoc rewrite of an existing file', () => {
		const command = `cat > ${EXISTING_TARGET} <<'EOF'\nnew body\nEOF`

		expect(delivered_for('fb-heredoc', command)).toBe(delivered_rules.FILE_BODY_REASON)
	})

	it.each([
		['node -e', "node -e \"require('fs').writeFileSync('x.ts', body)\""],
		['perl -i', "perl -0pi -e 's/old/new/' CLAUDE.md"],
	])('delivers on a %s write', (_name, command) => {
		expect(delivered_for(`fb-${_name}`, command)).toBe(delivered_rules.FILE_BODY_REASON)
	})

	it.each([
		['new file', "cat > new-file.ts <<'EOF'\nbody\nEOF"],
		['read-only heredoc', "cat <<'EOF'\njust reading\nEOF"],
	])('is silent on a %s', (_name, command) => {
		expect(delivered_for(`fbs-${_name}`, command)).toBeUndefined()
	})

	it(CLAIMED_TITLE, () => {
		expect(rules_claiming("perl -0pi -e 's/a/b/' CLAUDE.md")).toBe(ONE_RULE)
	})
})
