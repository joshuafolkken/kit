import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, WORKFLOW_PROMPT } from './ai-document-fixture'

const SETTINGS_PATH = fileURLToPath(new URL('../.claude/settings.json', import.meta.url))
const GITIGNORE_PATH = fileURLToPath(new URL('../.gitignore', import.meta.url))
const SYNC_DOC_PATH = fileURLToPath(new URL('../docs/sync.md', import.meta.url))

interface PermissionsBlock {
	defaultMode: string
	allow: ReadonlyArray<string>
	deny: ReadonlyArray<string>
}

interface SettingsShape {
	permissions: PermissionsBlock
}

function load_settings(): SettingsShape {
	const raw = readFileSync(SETTINGS_PATH, 'utf8')

	return JSON.parse(raw) as SettingsShape
}

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

const REQUIRED_DENY_PATTERNS: ReadonlyArray<string> = [
	'Bash(rm -rf *)',
	'Bash(rm -rf /*)',
	'Bash(git push --force*)',
	'Bash(git push -f*)',
	...INDEX_DENY_PATTERNS,
	PR_MERGE_DENY,
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
// Every git entry except the force-push pair belongs to the index guard, so the settings file
// itself decides what the documents have to enumerate — an entry added there and nowhere else
// fails here instead of leaving the documents describing a weaker guard than the one shipped.
const INDEX_ENTRY_PATTERN = /^Bash\(git (?!push)/u

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

	it.each([...INDEX_DENY_PATTERNS, PR_MERGE_DENY])('models %s exactly', (pattern) => {
		expect(pattern).toMatch(PREFIX_ENTRY_PATTERN)
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
]

const WORKFLOW_MARKERS: ReadonlyArray<string> = [
	...INDEX_DENY_PATTERNS,
	'`Bash(gh pr merge*)`）で機械的に遮断されている',
	'deny には「そのターンでユーザーが明示指示した」という例外がないため',
	'ユーザー自身の端末で実行してもらう',
	'「拒否される操作」と「禁止された操作」は同じ集合ではない',
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

describe('.claude/settings.json — deletion-policy hook reconciliation', () => {
	it('frames git-tracked deletion as reversible and not a Tier C action', () => {
		const raw = readFileSync(SETTINGS_PATH, 'utf8')

		expect(raw).toContain('git restore')
		expect(raw).toMatch(/reversible/u)
		expect(raw).toMatch(/Tier C/u)
	})

	it('still requires inspecting the target before deleting', () => {
		const raw = readFileSync(SETTINGS_PATH, 'utf8')

		expect(raw).toMatch(/inspect the target first/u)
		expect(raw).not.toContain('proceed directly')
	})
})

describe('.gitignore — Claude Code runtime artifacts', () => {
	it('ignores .claude/scheduled_tasks.lock so it never lands in commits', () => {
		const gitignore = readFileSync(GITIGNORE_PATH, 'utf8')

		expect(gitignore).toMatch(/^\.claude\/scheduled_tasks\.lock$/mu)
	})
})
