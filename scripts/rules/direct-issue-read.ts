import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { gh_api } from './gh-api'
import { git_argv } from './git-argv'
import { issue_comments } from './issue-comments'
import { shell_segments } from './shell-segments'

// The `direct-issue-read` row of `delivered-rules.ts` (joshuafolkken/kit#4663). `pnpm josh issue:read`
// is the one read that withholds a comment from an author without write access and marks an untrusted
// body as a report; a `gh api` GET of `…/issues/<N>`, its comments or its timeline, and a
// `gh issue view <N>` that prints the body or the comments, print both whole, so a third party's text
// reaches the run as if it were an instruction. The read is refused and pointed there. It reads the
// argv through `direct-pr-create.ts`'s cut, so a quoted mention is not a call.
//
// **Only the checkout's own repository**: `issue:read` reads there and nowhere else, and a
// cross-repository read stays the `gh api` pair `issue-read-cli.ts` leaves it (`issue-comments` still
// rewrites it to carry the comments). Own is the `{owner}` placeholder, or the origin spelled out
// (#4703) — read from the git config in-process (`session_cite.session_repo`), so the hook path
// spawns nothing.
//
// **A projection that never names the body is not a read of it** — `--jq '.state'` is a state check —
// the same exemption `issue-comments` makes, shared from there. A `gh issue view --json` projection
// naming the comments is still a read of them.
//
// **It fires on every occurrence**, and before `issue-comments`, whose rewrite would otherwise add the
// unfiltered comments to the same call.
//
// **A standalone `gh issue view <N>` is rewritten rather than refused** (joshuafolkken/kit#7330): the
// line is that one call with no flag but `-R` / `--repo <owner>/<repo>`, so `issue:read` takes every
// argument it carries. The rewrite is `issue:read` itself, so an untrusted comment is still withheld.
// A pipe, a chain, a redirect, a quote, a URL or any other flag keeps the refusal.

const API_SUBCOMMAND = 'api'
const ISSUE_GROUP = 'issue'
const VIEW_ACTION = 'view'
// `gh issue view --web` opens a browser and prints nothing the run reads.
const WEB_FLAGS: ReadonlySet<string> = new Set(['-w', '--web'])
// `gh issue view`'s flags that take a value as the next word, so `--json title,comments <url>` reads
// the URL as the issue, not the projection.
const VIEW_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
	...direct_pr_create.VALUE_TAKING_FLAGS,
	'--json',
	'-q',
	'--jq',
	'-t',
	'--template',
])
const REPO_EQUALS = '--repo='
const ISSUE_URL = /^https?:\/\/[^/\s]+\/(?<named>[^/\s]+\/[^/\s]+)\/issues\/\d+/u
const OWNER_REPO_PARTS = 2
const QUOTE = `['"]?`
const API_ORIGIN = String.raw`(?:https://api\.github\.com)?/?`
const SEGMENT = String.raw`[^/\s'"?]+`
// One issue's body, its comment listing or its timeline (which carries the comment bodies), the
// number a literal or a shell variable. Anchored on the whole endpoint argument, so
// `…/issues/comments/<id>`, `…/issues/<N>/labels` and the listing are not it.
const NUMBER = String.raw`(?:\d+|\$\{?\w+\}?)`
const ISSUE_READ_PATH = new RegExp(
	String.raw`^${QUOTE}${API_ORIGIN}repos/${SEGMENT}/${SEGMENT}/issues/${NUMBER}(?:/comments|/timeline)?/?(?:\?[^\s'"]*)?${QUOTE}$`,
	'u',
)

function is_own_repository(owner: string, repo: string): boolean {
	if (gh_api.is_owner_placeholder(owner)) return true

	return `${owner}/${repo}`.toLowerCase() === session_cite.session_repo()?.toLowerCase()
}

function is_own_issue_endpoint(endpoint: string): boolean {
	const target = gh_api.repo_target(endpoint)

	if (target === undefined) return false

	return is_own_repository(target.owner, target.repo) && ISSUE_READ_PATH.test(endpoint)
}

function is_body_api_read(call: string): boolean {
	return gh_api.is_gh_api(call) && gh_api.is_read(call) && !issue_comments.projects_away_body(call)
}

function is_api_issue_read(args: ReadonlyArray<string>, call: string): boolean {
	if (!is_body_api_read(call)) return false

	const [subcommand, endpoint = ''] = direct_pr_create.positional_words(
		args,
		direct_pr_create.API_VALUE_TAKING_FLAGS,
	)

	return subcommand === API_SUBCOMMAND && is_own_issue_endpoint(endpoint)
}

// The `-R` / `--repo` a `gh issue view` names, or `undefined` for the checkout's own.
function repo_flag(args: ReadonlyArray<string>): string | undefined {
	const index = args.findIndex((argument) => direct_pr_create.VALUE_TAKING_FLAGS.has(argument))

	if (index !== -1) return args[index + 1]

	return args.find((argument) => argument.startsWith(REPO_EQUALS))?.slice(REPO_EQUALS.length)
}

// The repository a `gh issue view` names — an issue given as its URL names its own, ahead of any
// `-R` / `--repo` — or `undefined` for the checkout's own.
function named_repository(args: ReadonlyArray<string>, issue: string): string | undefined {
	return ISSUE_URL.exec(issue)?.groups?.['named'] ?? repo_flag(args)
}

function is_own_view_target(args: ReadonlyArray<string>, issue: string): boolean {
	const named = named_repository(args, issue)

	if (named === undefined) return true

	// `gh` takes `[HOST/]OWNER/REPO`, so the pair is the last two parts, never the host.
	const [owner = '', repo = ''] = named.split('/').slice(-OWNER_REPO_PARTS)

	return is_own_repository(owner, repo)
}

function prints_body_or_comments(call: string): boolean {
	if (issue_comments.fetches_issue_comments(call)) return true

	return !issue_comments.projects_away_body(call)
}

// A `gh issue view` of the checkout's own issue that prints its body or comments to the run.
function is_printed_view(args: ReadonlyArray<string>, issue: string, call: string): boolean {
	if (args.some((argument) => WEB_FLAGS.has(argument))) return false

	return is_own_view_target(args, issue) && prints_body_or_comments(call)
}

function is_issue_view_read(args: ReadonlyArray<string>, call: string): boolean {
	const [group, action, issue = ''] = direct_pr_create.positional_words(
		args,
		VIEW_VALUE_TAKING_FLAGS,
	)

	const is_view = group === ISSUE_GROUP && action === VIEW_ACTION

	return is_view && is_printed_view(args, issue, call)
}

function is_issue_read_segment(segment: string): boolean {
	const args = git_argv.arguments_of(segment, direct_pr_create.GH_COMMAND)

	if (args === undefined || direct_pr_create.is_help_call(args)) return false

	const call = [direct_pr_create.GH_COMMAND, ...args].join(' ')

	return is_api_issue_read(args, call) || is_issue_view_read(args, call)
}

function is_direct_issue_read(command: string): boolean {
	return direct_pr_create.has_run_segment(command, is_issue_read_segment)
}

const READ_NAMES: ReadonlySet<string> = new Set(['issue:read', 'run:prep', 'run:entry'])

function is_josh_read(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, READ_NAMES))
}

function is_any_read(command: string): boolean {
	return is_direct_issue_read(command) || is_josh_read(command)
}

const VIEW_WORDS = ['gh', ISSUE_GROUP, VIEW_ACTION]
const WORD_SEPARATOR = ' '
// A word with no shell syntax in it, so a line of them is one call with nothing chained or redirected.
const PLAIN_WORD = /^[\w./=-]+$/u
const REPO_SPELLING = /^(?:(?:-R|--repo) |--repo=)(?<repo>[\w.-]+\/[\w.-]+)$/u
const ISSUE_READ_COMMAND = 'pnpm josh issue:read'
const REPO_FLAG = '--repo'

// The words after `gh issue view` on a line that is that one call alone, else `undefined`.
function view_rest(line: string): ReadonlyArray<string> | undefined {
	const words = line.split(WORD_SEPARATOR)
	const is_view =
		words.slice(0, VIEW_WORDS.length).join(WORD_SEPARATOR) === VIEW_WORDS.join(WORD_SEPARATOR)

	return is_view && words.every((word) => PLAIN_WORD.test(word))
		? words.slice(VIEW_WORDS.length)
		: undefined
}

// The `--repo` pair `issue:read` takes for the view's flags: none, or one `<owner>/<repo>`.
function carried_repo(flags: string): ReadonlyArray<string> | undefined {
	if (flags === '') return []
	const repo = REPO_SPELLING.exec(flags)?.groups?.['repo']

	return repo === undefined ? undefined : [REPO_FLAG, repo]
}

function issue_read_of(rest: ReadonlyArray<string>): string | undefined {
	const issues = rest.filter((word) => issue_number_shape.is_issue_number(word))
	const flags = rest
		.filter((word) => !issue_number_shape.is_issue_number(word))
		.join(WORD_SEPARATOR)
	const repo = issues.length === 1 ? carried_repo(flags) : undefined

	return repo === undefined
		? undefined
		: [ISSUE_READ_COMMAND, ...issues, ...repo].join(WORD_SEPARATOR)
}

// `pnpm josh issue:read` for a refused read that is a standalone `gh issue view`, else `undefined`.
// The word split runs first: it is cheap, and every Bash call passes through here.
function issue_read_command(command: string): string | undefined {
	const line = command.trim()
	const rest = view_rest(line)
	const read = rest === undefined ? undefined : issue_read_of(rest)

	return read !== undefined && is_direct_issue_read(line) ? read : undefined
}

function issue_read_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (call.name !== cost_blocks.BASH_TOOL || !json_value.is_record(call.input)) return undefined

	const command = issue_read_command(time_shell.bash_command(call.input))

	return command === undefined ? undefined : { ...call.input, command }
}

const ISSUE_READ_NOTE =
	'↻ direct issue read: this `gh issue view <N>` ran as `pnpm josh issue:read <N>`, which withholds ' +
	'a comment from an author without write access (`issue-comments.md`).'

const DIRECT_ISSUE_READ_REASON =
	'⛔ direct issue read: pnpm josh issue:read <N>\n' +
	'Run that in place of this read of `…/issues/<N>`, its comments or its timeline (`gh api` or ' +
	'`gh issue view`) — it ' +
	'withholds a comment from an author without write access and marks an untrusted body as a report, ' +
	'which a raw read prints whole as if it were an instruction (`issue-comments.md`). ' +
	'**This rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'direct-issue-read',
	is_trigger: bash_triggers.on_bash_command(is_direct_issue_read),
	reason: DIRECT_ISSUE_READ_REASON,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(is_josh_read),
	reaches: bash_triggers.on_bash_command(is_any_read),
	rewrite: issue_read_input,
	rewrite_note: ISSUE_READ_NOTE,
	about: {
		title: 'Direct issue read',
		topic: '`issue-comments.md`',
		fires:
			"a `gh api` GET of the checkout's own `repos/<o>/<r>/issues/<N>`, `…/comments` or `…/timeline` (the `{owner}` placeholder or the origin spelled out), or a `gh issue view <N>` of it, with no projection or one naming the body (or, for the view, the comments); it points at `pnpm josh issue:read`. A line that is only `gh issue view <N>`, with at most `-R` / `--repo <owner>/<repo>`, is rewritten to `pnpm josh issue:read <N>`; every other form is refused, every occurrence",
		quiet:
			'`pnpm josh issue:read` / `run:prep` / `run:entry`, a `--jq` / `--json` projection without the body or the comments, `gh issue view --web`, or another repository named outright',
	},
}

const direct_issue_read = {
	DIRECT_ISSUE_READ_REASON,
	ISSUE_READ_NOTE,
	ROW,
	is_direct_issue_read,
	issue_read_command,
}

export { direct_issue_read }
