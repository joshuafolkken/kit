import { existsSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MARKDOWN_EXTENSION, markdown_files_under } from './shipped-documents-fixture'
import { package_file } from './skill-fixture'

// joshuafolkken/kit#1064: joshuafolkken/kit#1022 moved kit's own GitHub calls to REST and
// joshuafolkken/kit#1054 moved the distributed documents, because `gh issue …` / `gh pr …` /
// `gh label …` / `gh repo …` all go through GraphQL, which a cloud session is answered 403 for.
// `prompts/git-automation.md` was the one document left behind, and it has now been retired rather
// than converted — every procedure it described is `pnpm josh git` / `pnpm josh followup`.
//
// Nothing stopped a new `gh <noun> <verb>` from being written into a shipped document. A document
// is the instruction surface an agent copies from, so a forbidden command reaching one fails
// exactly as a forbidden spawn in code does — silently, and only in a cloud session.
//
// **This is deliberately not an extension of `gh-subcommand-guard.ts`.** That guard walks a
// TypeScript syntax tree to find a spawn; this one reads markdown. They share no logic, and the
// module that guards code loads the TypeScript compiler, which every document suite would then pay
// for. The two were kept independent on purpose (`scripts/gh-subcommand-guard.ts` says so from its
// own side), and the `api` literal below is the only fact they have in common.
//
// **The scan is scoped to fenced code blocks, and that scope is the whole design.** A prose matcher
// would be wrong on this repository in both directions at once: measured before this guard was
// written, every non-`api` `gh` command outside `git-automation.md` — 25 of them across `CLAUDE.md`,
// `prompts/collaboration-workflow/`, and `.claude/skills/` — is a prohibition being quoted or a
// record of what the CLI can do, each already carrying the 403 reason beside it. A matcher that
// flagged all 25 would ship as an allowlist of its own false positives, which guards nothing. A
// fenced block is different: it is the runnable form, the thing an agent copies. Forbidding it there
// and nowhere else draws the "instructs" / "quotes while forbidding" line syntactically instead of
// by a heuristic. On the tree this guard was written against, that scope has zero false positives.
//
// The file set is derived from `package.json` → `files` rather than listed here, so a document
// directory added to the distribution is scanned without anyone remembering to add it twice.

interface SourceLine {
	line: number
	text: string
}

interface DocumentCommand {
	file: string
	line: number
	subcommand: string
}

interface Fence {
	marker: string
	info: string
}

interface AllowedCommand {
	subcommand: string
	reason: string
}

const MANIFEST = 'package.json'
const NEGATION_PREFIX = '!'
const API_SUBCOMMAND = 'api'
const BACKTICK = '`'
const NO_INFO_STRING = ''

// Shipped instruction files that are not markdown, and so are not found by the extension filter.
const EXTRA_DOCUMENT_FILES: ReadonlySet<string> = new Set(['.cursorrules'])

// The `gh` invocations that are not GitHub API calls, each with why it cannot be expressed as one.
// Everything else written inside a runnable block must start with `api`.
const ALLOWED_COMMANDS: ReadonlyArray<AllowedCommand> = [
	{
		subcommand: 'auth',
		reason:
			'`gh auth login` / `gh auth status` act on the credential the local CLI holds. They are setup and diagnosis steps a person runs, not requests against a repository, so there is no REST call they could be rewritten as.',
	},
]

// A fence: three or more backticks or tildes, after any indentation and any blockquote markers. The
// leading class is deliberately wider than CommonMark's three-space limit — a fence nested two list
// levels deep, or written inside a `>` block, is an ordinary thing to find in these documents, and a
// scan that did not enter it would leave its contents unread.
const FENCE_PATTERN = /^[\t >]*(`{3,}|~{3,})/u
// One `gh` invocation: the binary as a whole word, then everything up to the next command
// separator. The leading class keeps `through` and `high` from matching, and lets the command be
// quoted, parenthesised, assigned, or chained after `;` / `|` / `&`.
const GH_COMMAND_PATTERN = /(?:^|[\s"'`($=;|&])gh\s+([^\n;|&]+)/gu
const WHITESPACE_PATTERN = /\s+/u
// The separator the match opens with, and the binary itself — dropped so that `gh` is not read as
// its own subcommand. The match starts at the one character before `gh`, so the first `gh` in it is
// always the binary.
const GH_PREFIX_PATTERN = /^.*?\bgh\s+/u
// A token that can be the subcommand. Global options come before it and a flag's value can follow
// one, so `-R` and `owner/repo` are both stepped over: `gh -R owner/repo issue list` is
// `gh issue list`. A flag value that happens to look like a subcommand degrades toward reporting
// the wrong word, which still fails the scan; it cannot degrade into silence.
const SUBCOMMAND_PATTERN = /^[a-z][\w-]*$/u

const GUIDANCE = [
	'A distributed document must not put a GraphQL-backed `gh` command in a runnable block — a cloud',
	'session is answered 403. Rewrite it as `gh api …`, or point at the `pnpm josh` command that',
	'already does it. To explain a forbidden command rather than instruct one, write it in inline',
	'backticks: only fenced blocks are scanned.',
].join(' ')

function is_document(entry: string): boolean {
	return entry.endsWith(MARKDOWN_EXTENSION) || EXTRA_DOCUMENT_FILES.has(entry)
}

// joshuafolkken/kit#1107: the walk prunes nested `node_modules` and nested checkouts rather than
// flattening the tree, because `.claude` is a shipped directory and Claude Code puts its bridge work
// trees under it. `shipped-documents-fixture.ts` carries the reasoning and the prune itself.
function documents_under(entry: string): Array<string> {
	const absolute = package_file(entry)
	if (!existsSync(absolute)) return []
	if (!statSync(absolute).isDirectory()) return is_document(entry) ? [entry] : []

	return markdown_files_under(absolute).map((name) => `${entry}/${name}`)
}

function manifest_files(): ReadonlyArray<string> {
	const manifest: unknown = JSON.parse(readFileSync(package_file(MANIFEST), 'utf8'))

	return (manifest as { files: ReadonlyArray<string> }).files
}

function manifest_entries(): ReadonlyArray<string> {
	return manifest_files().filter((entry) => !entry.startsWith(NEGATION_PREFIX))
}

// Every document this package ships, in a stable order.
function distributed_documents(): ReadonlyArray<string> {
	return manifest_entries()
		.flatMap((entry) => documents_under(entry))
		.toSorted((left, right) => left.localeCompare(right))
}

function to_fence(text: string): Fence | undefined {
	const match = FENCE_PATTERN.exec(text)
	const marker = match?.[1]
	if (match === null || marker === undefined) return undefined

	return { marker, info: text.slice(match[0].length).trim() }
}

// CommonMark, and both halves matter here. An opener's info string may not contain a backtick, so
// ```` ```x``` ```` is an inline span rather than a block; a closing fence carries no info string at
// all, so a ```` ```bash ```` line inside an open block is content rather than a close. Reading
// either one wrong flips the parity and drops every block after it from the scan in silence — the
// one failure a guard cannot afford.
function is_opener(fence: Fence): boolean {
	return !fence.marker.startsWith(BACKTICK) || !fence.info.includes(BACKTICK)
}

// A fence closes only on the same character, at least as long as the one that opened it — so a
// four-backtick block quoting a three-backtick one stays a single block.
function closes(open: string, fence: Fence | undefined): boolean {
	if (fence?.info !== NO_INFO_STRING) return false

	return fence.marker.startsWith(open.charAt(0)) && fence.marker.length >= open.length
}

// The marker in force after this line: the one it opens, nothing once it closes the open one, and
// otherwise whatever was already open.
function next_fence(open: string | undefined, fence: Fence | undefined): string | undefined {
	if (open !== undefined) return closes(open, fence) ? undefined : open
	if (fence === undefined || !is_opener(fence)) return undefined

	return fence.marker
}

function is_inside(open: string | undefined, after: string | undefined): boolean {
	return open !== undefined && after === open
}

function fenced_lines(source: string): Array<SourceLine> {
	const found: Array<SourceLine> = []
	let open: string | undefined

	for (const [index, text] of source.split('\n').entries()) {
		const after = next_fence(open, to_fence(text))
		if (is_inside(open, after)) found.push({ line: index + 1, text })
		open = after
	}

	return found
}

function to_subcommand(invocation: string): string | undefined {
	return invocation
		.replace(GH_PREFIX_PATTERN, '')
		.split(WHITESPACE_PATTERN)
		.find((token) => SUBCOMMAND_PATTERN.test(token))
}

function subcommands_in(text: string): Array<string> {
	return (text.match(GH_COMMAND_PATTERN) ?? []).flatMap((invocation) => {
		const subcommand = to_subcommand(invocation)

		return subcommand === undefined ? [] : [subcommand]
	})
}

function find_gh_commands(source: string, file: string): Array<DocumentCommand> {
	return fenced_lines(source).flatMap(({ line, text }) =>
		subcommands_in(text).map((subcommand) => ({ file, line, subcommand })),
	)
}

function is_allowed(command: DocumentCommand): boolean {
	if (command.subcommand === API_SUBCOMMAND) return true

	return ALLOWED_COMMANDS.some((entry) => entry.subcommand === command.subcommand)
}

function describe_violation(command: DocumentCommand): string {
	return `${command.file}:${String(command.line)} runs \`gh ${command.subcommand}\` — ${GUIDANCE}`
}

function scan_document(file: string): Array<DocumentCommand> {
	return find_gh_commands(readFileSync(package_file(file), 'utf8'), file)
}

function scan_distribution(): Array<DocumentCommand> {
	return distributed_documents().flatMap((file) => scan_document(file))
}

const FIXTURE_FILE = 'prompts/fixture.md'
const FENCE = '```'
const RETIRED_PROMPT = 'prompts/git-automation.md'
const OPERATING_RULES = 'prompts/collaboration-workflow/operating-rules.md'
const FOLLOWUP_SKILL = '.claude/skills/workflow-commands/followup.md'
const UNSHIPPED_DOC = 'docs/sync.md'
// The directory Claude Code keeps its runtime state in, and the two paths under it the package
// distributes. `init-logic.ts` copies from exactly these two — `.claude/settings.json`, and each
// skill directory by name — and nothing else under `.claude` is the package's to ship.
const CLAUDE_ROOT = '.claude'
const SHIPPED_CLAUDE_SETTINGS = '.claude/settings.json'
const SHIPPED_CLAUDE_SKILLS = '.claude/skills'
// Well under the count at the time of writing (53), so an ordinary addition or removal does not
// touch it while a directory dropping out of the scan does.
const MINIMUM_DOCUMENT_COUNT = 40

// The fixtures are document text handed to the scanner, not instructions to anyone, so writing a
// forbidden command out in full here is not itself one.
function fixture(...lines: ReadonlyArray<string>): Array<DocumentCommand> {
	return find_gh_commands(lines.join('\n'), FIXTURE_FILE)
}

function fixture_subcommands(...lines: ReadonlyArray<string>): Array<string> {
	return fixture(...lines).map((command) => command.subcommand)
}

describe('gh document guard — the distribution as it stands', () => {
	it('puts no GraphQL-backed gh command in a runnable block', () => {
		const violations = scan_distribution().filter((command) => !is_allowed(command))

		expect(violations.map((command) => describe_violation(command))).toStrictEqual([])
	})

	// A scan that read nothing would satisfy the assertion above without checking anything.
	it('reads the documents that carry the workflow procedures', () => {
		const documents = distributed_documents()

		expect(documents).toContain('CLAUDE.md')
		expect(documents).toContain(OPERATING_RULES)
		expect(documents).toContain(FOLLOWUP_SKILL)
	})

	// Derived from `files`, so a document the package does not ship is out of scope — `docs/` is
	// repository documentation and is free to quote whatever it explains.
	it('scans only what the package ships', () => {
		expect(distributed_documents()).not.toContain(UNSHIPPED_DOC)
	})

	// joshuafolkken/kit#1107: the walk stops at a nested checkout, and `files` has to stop there too
	// — the two answer the same question for different readers, and only one of them was answering
	// it. `.claude` is where Claude Code keeps its own runtime state, all of it invisible to git
	// through `.git/info/exclude` — a file npm never reads — so shipping the directory wholesale
	// published it: measured on a tarball carrying `checkpoints/`, `mailbox/` and
	// `scheduled_tasks.json`, plus a probe at `.claude/worktrees/<name>/docs/probe.md`. `josh sync`
	// copies this package's `.claude` into consumers, so none of it stopped at the registry either.
	//
	// Named subpaths rather than a list of exclusions, because the artifacts are Claude Code's to
	// add to: a blocklist is stale the first time a release invents a file, and each new name would
	// be found the way these were — by a document guard failing on a document nobody wrote.
	it('ships the two paths of `.claude` it distributes, not the directory', () => {
		expect(manifest_files()).toContain(SHIPPED_CLAUDE_SETTINGS)
		expect(manifest_files()).toContain(SHIPPED_CLAUDE_SKILLS)
		expect(manifest_files()).not.toContain(CLAUDE_ROOT)
	})

	// A `files` entry that stops resolving on disk — rewritten as a glob, or renamed — contributes
	// nothing and takes its documents out of the scan without failing anything. The floor is what
	// makes that shrink visible: the three pins above would still pass with everything else gone.
	it('does not quietly shrink to a handful of documents', () => {
		expect(distributed_documents().length).toBeGreaterThan(MINIMUM_DOCUMENT_COUNT)
	})

	// The retirement itself. The document is gone, and no shipped document still sends a reader to it.
	it('no longer ships the git-automation prompt, and nothing points at it', () => {
		const surface = distributed_documents().map((file) => readFileSync(package_file(file), 'utf8'))

		expect(existsSync(package_file(RETIRED_PROMPT))).toBe(false)
		expect(surface.join('\n')).not.toContain('git-automation')
	})
})

describe('gh document guard — what a runnable block is', () => {
	it('flags a forbidden command inside a fence', () => {
		expect(fixture_subcommands(`${FENCE}bash`, 'gh pr checks --watch', FENCE)).toStrictEqual(['pr'])
	})

	// The whole reason the scope is fences: `CLAUDE.md` and the workflow prompts quote these commands
	// while forbidding them, and every one of those quotes is correct.
	it('leaves a command quoted in prose alone', () => {
		expect(fixture_subcommands('Never run `gh pr merge` yourself — it is denied.')).toStrictEqual(
			[],
		)
	})

	it('accepts a REST call, and an allowlisted one', () => {
		const found = fixture(
			`${FENCE}bash`,
			'gh api repos/{owner}/{repo}/issues/1 --jq .title',
			'gh auth status',
			FENCE,
		)

		expect(found.map((command) => command.subcommand)).toStrictEqual([API_SUBCOMMAND, 'auth'])
		expect(found.every((command) => is_allowed(command))).toBe(true)
	})

	it('reads a fence with no language, and one opened with tildes', () => {
		expect(fixture_subcommands(FENCE, '$ gh issue view 1', FENCE)).toStrictEqual(['issue'])
		expect(fixture_subcommands('~~~', 'gh label list', '~~~')).toStrictEqual(['label'])
	})

	// A four-backtick block quoting a three-backtick one is one block, not two — read as two, the
	// commands after the inner fence fall outside every block and go unseen.
	it('keeps a longer fence open across a shorter one inside it', () => {
		expect(
			fixture_subcommands('````', FENCE, 'gh run watch', FENCE, 'gh pr create', '````'),
		).toStrictEqual(['run', 'pr'])
	})

	// A fence two list levels deep, and one inside a blockquote. Both are ordinary here, and a scan
	// anchored at column zero would read neither as a block at all.
	it('reads an indented fence and one inside a blockquote', () => {
		expect(fixture_subcommands(`  ${FENCE}`, '  gh issue view 1', `  ${FENCE}`)).toStrictEqual([
			'issue',
		])
		expect(fixture_subcommands(`> ${FENCE}`, '> gh pr merge 1', `> ${FENCE}`)).toStrictEqual(['pr'])
	})
})

describe('gh document guard — the shapes a command is written in', () => {
	// A global option sits before the subcommand, so reading the first word after `gh` would find
	// `-R` and report nothing at all.
	it('steps over global options to reach the subcommand', () => {
		expect(fixture_subcommands(`${FENCE}bash`, 'gh -R owner/repo issue list', FENCE)).toStrictEqual(
			['issue'],
		)
		expect(
			fixture_subcommands(`${FENCE}bash`, 'gh --repo owner/repo api repos/o/r', FENCE),
		).toStrictEqual([API_SUBCOMMAND])
	})

	it('finds both commands chained on one line', () => {
		expect(
			fixture_subcommands(`${FENCE}bash`, 'gh pr view 1 && gh issue close 2', FENCE),
		).toStrictEqual(['pr', 'issue'])
	})

	// An inline span at line start is not a block opener. Read as one it flips the parity, and every
	// real block after it goes unread.
	it('does not read an inline code span as a fence', () => {
		expect(
			fixture(`${FENCE}gh pr merge${FENCE}`, `${FENCE}bash`, 'gh issue close 1', FENCE),
		).toStrictEqual([{ file: FIXTURE_FILE, line: 3, subcommand: 'issue' }])
	})

	// A labelled fence inside an open block is content: it carries an info string, and a closing
	// fence never does.
	it('does not let a labelled fence inside a block close it', () => {
		expect(fixture_subcommands(FENCE, `${FENCE}bash`, 'gh pr merge 1', FENCE)).toStrictEqual(['pr'])
	})

	it('reports the line the command is written on', () => {
		expect(
			fixture('A note about `gh pr checks`.', '', `${FENCE}bash`, 'gh repo view', FENCE),
		).toStrictEqual([{ file: FIXTURE_FILE, line: 4, subcommand: 'repo' }])
	})
})

describe('gh document guard — what is not a gh command', () => {
	it('does not read the end of an ordinary word as the binary', () => {
		expect(fixture_subcommands(`${FENCE}bash`, 'echo "through high enough"', FENCE)).toStrictEqual(
			[],
		)
	})

	it('ignores another binary, and the josh wrapper', () => {
		expect(
			fixture_subcommands(`${FENCE}bash`, 'git status --short', 'pnpm josh git -y', FENCE),
		).toStrictEqual([])
	})
})

describe('gh document guard — the allowlist and the message', () => {
	it('gives every entry a reason', () => {
		for (const entry of ALLOWED_COMMANDS) {
			expect(entry.reason.length).toBeGreaterThan(0)
		}
	})

	it('names the file, the line, the command and what to do', () => {
		const message = describe_violation({ file: FIXTURE_FILE, line: 12, subcommand: 'pr' })

		expect(message).toContain(`${FIXTURE_FILE}:12`)
		expect(message).toContain('gh pr')
		expect(message).toContain('gh api')
		expect(message).toContain('inline backticks')
	})
})
