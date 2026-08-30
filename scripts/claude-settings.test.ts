import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'
import { claude_settings_fixture } from './claude-settings-fixture'

const SYNC_DOC_PATH = fileURLToPath(new URL('../docs/sync.md', import.meta.url))

const { load_settings } = claude_settings_fixture

// Every command that rewrites the index or ships work without going through `pnpm josh git`. The
// same list is what each paired document has to enumerate, so drift shows up as a failing test
// rather than as a document that describes a weaker guard than the one being distributed.
const INDEX_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(git add*)',
	'Bash(git stage*)',
	'Bash(git rm*)',
	'Bash(git mv*)',
	'Bash(git reset*)',
	'Bash(git restore --staged*)',
	'Bash(git restore -S*)',
	'Bash(git commit -a*)',
	'Bash(git commit --all*)',
]

const PR_MERGE_DENY = 'Bash(gh pr merge*)'

// joshuafolkken/kit#1022 moved this tooling's GitHub writes to `gh api`, which gave every write a
// second spelling the subcommand-shaped entries above never see. `gh pr merge` alone therefore left
// the merge reachable, which is what joshuafolkken/kit#1054 had to weaken the prose about. The path
// is matched rather than the method: `-X PUT` may sit before or after it, and an entry pinned to one
// ordering leaves the other open. Blocking a read of the same path is the accepted cost — merge
// state is read from `pulls/{N}` instead.
const REST_MERGE_DENY = 'Bash(gh api *pulls/*/merge*)'

const REST_MERGE_DENY_PATTERNS: ReadonlyArray<string> = [
	REST_MERGE_DENY,
	'Bash(gh api graphql*mergePullRequest*)',
]

// The same rule bullet forbids branch deletion and force pushes, and only the force-push half was
// denied — in a spelling that assumed the flag comes first. `git push origin main --force` escaped
// it. Deleting a branch had no entry at all despite sitting in that one sentence; no josh step
// force-pushes or deletes a branch, so denying them constrains nothing the workflow does.
//
// Every flag git spells both ways needs both here, and both positions of each: `--delete` and `-d`,
// `--force` and `-f`, and `+<ref>`, which force-updates with no flag at all. The short forms are
// written with a leading space so a branch whose name ends in `-f` or `-d` still pushes.
const SHARED_STATE_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(git push *--force*)',
	'Bash(git push * -f)',
	'Bash(git push * -f *)',
	'Bash(git push * +*)',
	'Bash(git push *--delete*)',
	'Bash(git push -d*)',
	'Bash(git push * -d)',
	'Bash(git push * -d *)',
	'Bash(git branch -d*)',
	'Bash(git branch -D*)',
	'Bash(git branch --delete*)',
	'Bash(gh api *DELETE*git/refs/heads/*)',
	'Bash(gh api *git/refs/heads/*DELETE*)',
]

// The flag-first force-push pair, which predates the audit and matches only a `--force` or `-f`
// written directly after `git push`. Named so the reconciliation below can account for it.
const FORCE_PUSH_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(git push --force*)',
	'Bash(git push -f*)',
]

// A short flag written straight after the wildcard — `*-f` rather than `* -f` — matches any branch
// name ending in `-f`, so it would block the manual push the recovery path in `CLAUDE.md` →
// "Git Rules" depends on. The space is the property that makes the short-flag entries safe, not an
// incidental formatting choice, and an entry missing it still passes every deny assertion.
const SHORT_FLAG_NO_SPACE_PATTERN = /\*-[a-zA-Z](?![a-zA-Z-])/u

const REQUIRED_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(rm -rf *)',
	'Bash(rm -rf /*)',
	...FORCE_PUSH_DENY_PATTERNS,
	...SHARED_STATE_DENY_PATTERNS,
	...INDEX_DENY_PATTERNS,
	PR_MERGE_DENY,
	...REST_MERGE_DENY_PATTERNS,
	'Bash(sudo *)',
]

// A deny entry was observed to apply to each command of a compound invocation, not only to the
// whole string, so the emulation splits on the shell separators before matching. It models a glob
// whose `*` follows the command text directly; a `*` behind a space (`Bash(rm -rf *)`) additionally
// carries a word boundary that this does not reproduce, which is why every entry added here is held
// to the prefix shape by a test below.
const COMMAND_SEPARATOR_PATTERN = /&&|\|\||[\n;&|]/u
const REGEXP_SPECIAL_PATTERN = /[.*+?^${}()|[\]\\]/gu
const BASH_ENTRY_PATTERN = /^Bash\((.*)\)$/u
const PREFIX_ENTRY_PATTERN = /^Bash\([^)]*\S\*\)$/u
// Every git entry except the push and branch guards belongs to the index guard, so the settings
// file itself decides what the documents have to enumerate — an entry added there and nowhere else
// fails here instead of leaving the documents describing a weaker guard than the one shipped.
const INDEX_ENTRY_PATTERN = /^Bash\(git (?!push|branch)/u

// Only `Bash(...)` entries describe a shell command; any other tool's entry is skipped rather than
// turned into a pattern that quietly matches nothing.
function to_command_matcher(deny_entry: string): RegExp | undefined {
	const glob = BASH_ENTRY_PATTERN.exec(deny_entry)?.[1]

	if (glob === undefined) return undefined

	const escaped = glob.replaceAll(REGEXP_SPECIAL_PATTERN, (char) =>
		char === '*' ? '.*' : `\\${char}`,
	)

	return new RegExp(`^${escaped}$`, 'u')
}

function is_denied(deny_entries: ReadonlyArray<string>, command: string): boolean {
	const commands = command.split(COMMAND_SEPARATOR_PATTERN).map((part) => part.trim())
	const matchers = deny_entries.map((entry) => to_command_matcher(entry)).filter(Boolean)

	return matchers.some((matcher) => commands.some((part) => matcher?.test(part) === true))
}

const DENIED_COMMANDS: ReadonlyArray<string> = [
	'git add .',
	'git add -A',
	'git add --all src',
	'git stage .',
	'git mv old.ts new.ts',
	'git rm --cached notes.txt',
	'git rm -r --cached build',
	'git restore --staged src/app.ts',
	'git restore -S src/app.ts',
	'git reset HEAD~1',
	'git reset --hard origin/main',
	'gh pr merge 850 --merge',
	'git commit -am "wip"',
	'git commit --all -m "wip"',
	'gh pr merge my-branch --squash',
	'cd docs && git add .',
	'cd docs\ngit add .',
	// Every entry below was observed being refused by the running harness before it was written
	// here, because an unverified deny is the state joshuafolkken/kit#1062 exists to remove. The
	// merge spellings are the ones `gh pr merge*` never saw.
	'gh api -X PUT repos/joshuafolkken/kit/pulls/999999/merge',
	'gh api repos/joshuafolkken/kit/pulls/999999/merge --method PUT',
	'gh api "repos/{owner}/{repo}/pulls/999999/merge" -X PUT -f merge_method=merge',
	'gh api graphql -f query=\'mutation { mergePullRequest(input: {pullRequestId: "x"}) { clientMutationId } }\'',
	// A force push writes the flag last as readily as first, and only the first was denied.
	'git push zz-nonexistent-remote main --force',
	'git push zz-nonexistent-remote main -f',
	'git push zz-nonexistent-remote main -f --tags',
	// Branch deletion sits in the same rule sentence as the merge and the force push, and had no
	// entry of its own.
	'git push zz-nonexistent-remote --delete zz-branch',
	'git branch -d zz-branch',
	'git branch -D zz-branch',
	'gh api -X DELETE repos/joshuafolkken/kit/git/refs/heads/zz-branch',
	'gh api repos/joshuafolkken/kit/git/refs/heads/zz-branch --method DELETE',
	// git spells both of these two ways, and the first pass covered only one of each. `+<ref>` is
	// the third force-push spelling and carries no flag at all.
	'git push zz-nonexistent-remote origin +main',
	'git push -d zz-nonexistent-remote zz-branch',
	'git push zz-nonexistent-remote -d zz-branch',
	'git push zz-nonexistent-remote zz-branch -d',
	'git branch --delete zz-branch',
]

const COMMIT_TITLE = 'Deny direct git index and PR merge commands #850'

// The workflow drives git and gh from inside node scripts, so the Bash matcher only ever sees the
// `pnpm josh ...` wrapper — denying the direct commands must leave every josh step runnable. The
// read-only inspection commands the prompts require, and the stash steps `fullrun new` / `queue`
// perform, have to survive too. Being unblocked is not an endorsement: the prose rule still governs
// when a command may be run — `git restore <path>` stays unblocked because it is the documented
// recovery path, and is still not something to reach for autonomously.
const UNBLOCKED_COMMANDS: ReadonlyArray<string> = [
	`pnpm josh git -y "${COMMIT_TITLE}"`,
	`pnpm josh followup "${COMMIT_TITLE}" --merge`,
	'pnpm josh ms',
	'pnpm josh bump minor',
	'git status --short',
	'git diff --staged',
	'git diff main...HEAD',
	// The documented flows run this themselves; `git stash pop` reapplies everything unstaged, which
	// is a hole in the same guard — tracked in the sync doc rather than closed by a deny entry.
	'git stash',
	'git restore src/app.ts',
	'gh pr view 850 --json url',
	'gh issue comment 850 --body "done"',
	// The reads the REST-era workflow is built on. Each was run against the live API while the new
	// entries were in force, so the merge and ref guards are known not to have taken the workflow
	// with them.
	'gh api "repos/{owner}/{repo}/issues/1062" --jq .title',
	'gh api repos/joshuafolkken/kit/pulls/1019 --jq .merged',
	'gh api "repos/{owner}/{repo}/pulls/1019/comments" --jq length',
	'gh api repos/joshuafolkken/kit/git/refs/heads/main --jq .object.type',
	'git branch --show-current',
	'git branch -a',
	// The manual push the recovery path in `CLAUDE.md` → "Git Rules" prescribes when
	// `pnpm josh git -y` fails at its push step. The last two are the reason the short-flag entries
	// carry a leading space: a branch whose name ends in `-f` must still be able to be pushed.
	'git push zz-nonexistent-remote',
	'git push -u zz-nonexistent-remote my-feature-f',
	'git push zz-nonexistent-remote HEAD:refs/heads/wip-f',
	'git push -u zz-nonexistent-remote my-feature-d',
	'git push zz-nonexistent-remote HEAD:refs/heads/wip-d',
]

describe('.claude/settings.json — permissions', () => {
	it('keeps defaultMode set to bypassPermissions', () => {
		const settings = load_settings()

		expect(settings.permissions.defaultMode).toBe('bypassPermissions')
	})

	it('allows all Bash commands via wildcard so per-command entries do not accumulate', () => {
		const settings = load_settings()

		expect(settings.permissions.allow).toContain('Bash(*)')
	})

	it.each(REQUIRED_DENY_PATTERNS)('blocks dangerous pattern %s in deny list', (pattern) => {
		const settings = load_settings()

		expect(settings.permissions.deny).toContain(pattern)
	})

	// Measured against the running harness rather than read out of the documentation: `Bash(zzp4 *
	// =*)` refused `zzp4 aaa =bbb`, while `Bash(zzp1 * :*)` and `Bash(zzp2 *:*)` let `zzp1 aaa :bbb`
	// and `zzp2 aaa:bbb` through. A `:` is grammar in a rule — the `:*` suffix form — so an entry
	// carrying one matches nothing and ships as a guard that was never in force. `git push origin
	// :branch` is the deletion spelling this costs us; the prose rule covers it instead.
	// Scoped to `Bash(...)`, which is where the measurement was taken. Another tool's rule has its
	// own grammar — a `WebFetch(domain:…)` entry is not evidence of anything about this one.
	it('writes no Bash deny entry containing a colon, which matches no literal colon', () => {
		const settings = load_settings()
		const with_colon = settings.permissions.deny
			.filter((entry) => BASH_ENTRY_PATTERN.test(entry))
			.filter((entry) => entry.includes(':'))

		expect(with_colon).toStrictEqual([])
	})
})

describe('deny pattern emulation', () => {
	// A deny entry for another tool is legitimate hardening; the emulation leaves it alone rather
	// than turning it into a shell pattern, so adding one must not fail these suites.
	it('skips a deny entry that is not a Bash command pattern', () => {
		expect(to_command_matcher('Read(**/.env)')).toBeUndefined()
	})

	it('enumerates every index deny entry the settings file ships', () => {
		const settings = load_settings()
		const shipped = settings.permissions.deny.filter((entry) => INDEX_ENTRY_PATTERN.test(entry))

		expect(new Set(shipped)).toStrictEqual(new Set(INDEX_DENY_PATTERNS))
	})

	it.each([...INDEX_DENY_PATTERNS, PR_MERGE_DENY, ...REST_MERGE_DENY_PATTERNS])(
		'models %s exactly',
		(pattern) => {
			expect(pattern).toMatch(PREFIX_ENTRY_PATTERN)
		},
	)

	// The index reconciliation above covers one family; this covers the rest, so a `gh api` or
	// `git push` entry added to the settings file and nowhere else fails here rather than shipping
	// with no test and no document naming it. Non-`Bash` entries stay free — another tool's rule is
	// legitimate hardening this suite has nothing to say about.
	it('declares every Bash deny entry the settings file ships', () => {
		const settings = load_settings()
		const shipped = settings.permissions.deny.filter((entry) => BASH_ENTRY_PATTERN.test(entry))

		expect(shipped.filter((entry) => !REQUIRED_DENY_PATTERNS.includes(entry))).toStrictEqual([])
	})

	it.each(SHARED_STATE_DENY_PATTERNS)('keeps the space in front of a short flag in %s', (entry) => {
		expect(entry).not.toMatch(SHORT_FLAG_NO_SPACE_PATTERN)
	})
})

describe('.claude/settings.json — deny patterns', () => {
	it.each(DENIED_COMMANDS)('blocks the direct command %s', (command) => {
		const settings = load_settings()

		expect(is_denied(settings.permissions.deny, command)).toBe(true)
	})

	it.each(UNBLOCKED_COMMANDS)('leaves %s unblocked', (command) => {
		const settings = load_settings()

		expect(is_denied(settings.permissions.deny, command)).toBe(false)
	})
})

describe('docs/sync.md — deny rationale', () => {
	it('records why the git index and PR merge commands are denied', () => {
		const sync_document = readFileSync(SYNC_DOC_PATH, 'utf8')

		for (const pattern of INDEX_DENY_PATTERNS) expect(sync_document).toContain(pattern)

		expect(sync_document).toContain(PR_MERGE_DENY)
		expect(sync_document).toMatch(/pnpm josh git/u)
	})

	// The REST spellings are the half a reader is least likely to guess at, so the rationale has to
	// name them rather than leave the entries to speak for themselves.
	it.each([...REST_MERGE_DENY_PATTERNS, ...SHARED_STATE_DENY_PATTERNS])(
		'records why %s is denied',
		(pattern) => {
			expect(readFileSync(SYNC_DOC_PATH, 'utf8')).toContain(pattern)
		},
	)

	it('records that a literal colon cannot be matched by a deny entry', () => {
		const sync_document = readFileSync(SYNC_DOC_PATH, 'utf8')

		expect(sync_document).toContain('git push origin :branch')
	})
})

// The deny list only holds while every copy of the prose says the same thing: a doc that still
// reads "ask first" without naming the deny sends an agent looking for an exception that the tool
// no longer grants.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'denies `gh pr merge` outright',
	PR_MERGE_DENY,
	'The deny carries no per-turn exception',
	'ask the user to run it in their own terminal',
	'**Refused and forbidden are not the same set**',
	'Never read "the tool let me" as permission.',
	...INDEX_DENY_PATTERNS,
	// joshuafolkken/kit#1054 replaced an overstated claim with an understated one — the REST merge
	// is denied now, and saying it is not sends an agent looking for a hole that was closed. The
	// pair below has to stay pinned together: the entry that closed it, and the sentence saying the
	// list is still not the boundary of what is forbidden.
	REST_MERGE_DENY,
	'**The deny is still narrower than the rule**',
]

const WORKFLOW_MARKERS: ReadonlyArray<string> = [
	...INDEX_DENY_PATTERNS,
	'`Bash(gh pr merge*)`）で機械的に遮断されている',
	'deny には「そのターンでユーザーが明示指示した」という例外がないため',
	'ユーザー自身の端末で実行してもらう',
	'「拒否される操作」と「禁止された操作」は同じ集合ではない',
	'**ただし deny は実装であって規則ではない**',
	'**それでも deny は規則より狭い**',
	'「マージ経路は deny が保証している」とは読まないこと',
]

describe.each(AI_DOCS)('%s — deny rule reaches every paired doc', (document_path) => {
	const content = read_repo_file(document_path)

	it.each(AI_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${WORKFLOW_PROMPT} — canonical deny rationale`, () => {
	const content = read_repo_file(WORKFLOW_PROMPT)

	it.each(WORKFLOW_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
