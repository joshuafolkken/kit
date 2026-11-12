import path from 'node:path'
import type { RepoIdentity } from '#scripts/discovery/repo-origin'
import { repo_party } from '#scripts/discovery/repo-party'
import type { HookContext } from '#scripts/hooks/hook-context'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { gh_api } from './gh-api'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'
import { standalone_gh_call, type StandaloneCall } from './standalone-gh-call'

// The `direct-issue-comment` row of `delivered-rules.ts`. A run's own comment has to carry
// `RUN_MARKER`, or `issue-watch-diff.ts` reads it as a person's update: the run's review then reads as
// briefed before the issue changed, and `josh followup` refuses the merge (joshuafolkken/kit#4221).
// `pnpm josh issue:comment` is the one path that writes the marker, so a hand-built `gh issue comment`
// or `gh api` write to `…/issues/<N>/comments` is refused and pointed there. It reads the argv through
// `direct-pr-create.ts`'s cut, so a quoted mention is not a call and `bash -c '…'` still is.
//
// **Only the checkout's own repository**: `issue:comment` posts there and nowhere else, so the row
// claims the spellings that target it — the `{owner}` placeholder, the checkout's own `owner/repo`
// spelled out (the one repository the placeholders can expand to, `repo_party.current_repository`, the
// candidate set `third-party-write` reads; joshuafolkken/kit#4737), and `gh issue comment` with no
// repository selector. A comment to another repository named outright is left to `third-party-write`,
// and so is every spelled-out one where the placeholders could expand to more than one repository.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const ISSUE_GROUP = 'issue'
const COMMENT_ACTION = 'comment'
const API_SUBCOMMAND = 'api'
const REPO_SELECTOR = /^(?:-R|--repo)(?:=|$)/u
// One issue's (or pull request's — REST serves both as issues) comment collection. Anchored on the
// whole endpoint argument, so `…/issues/comments/<id>` and a listing elsewhere are not read as it. The
// number is any one segment, so `issues/$N/comments` is seen as well.
const SEGMENT = String.raw`[^/\s'"]+`
const QUOTE = `['"]?`
const API_ORIGIN = String.raw`(?:https://api\.github\.com)?/?`
const COMMENTS_PATH = new RegExp(
	`^${QUOTE}${API_ORIGIN}repos/${SEGMENT}/${SEGMENT}/issues/${SEGMENT}/comments/?${QUOTE}$`,
	'u',
)

function is_comment_cli_call(args: ReadonlyArray<string>): boolean {
	if (args.some((argument) => REPO_SELECTOR.test(argument))) return false

	const [group, action] = direct_pr_create.positional_words(
		args,
		direct_pr_create.VALUE_TAKING_FLAGS,
	)

	return group === ISSUE_GROUP && action === COMMENT_ACTION
}

type ResolveOwnRepository = () => RepoIdentity | undefined

// The checkout's own repository is read only for an owner spelled out, so a placeholder write and
// every other command pay nothing for the config read.
function is_own_comments_endpoint(endpoint: string, resolve_own: ResolveOwnRepository): boolean {
	const target = gh_api.repo_target(endpoint)

	if (target === undefined || !COMMENTS_PATH.test(endpoint)) return false

	return (
		gh_api.is_owner_placeholder(target.owner) || repo_party.is_own_repository(target, resolve_own())
	)
}

function is_comment_api_call(
	args: ReadonlyArray<string>,
	resolve_own: ResolveOwnRepository,
): boolean {
	const call = [direct_pr_create.GH_COMMAND, ...args].join(' ')

	if (!gh_api.is_gh_api(call) || !gh_api.is_write(call)) return false

	const [subcommand, endpoint = ''] = direct_pr_create.positional_words(
		args,
		direct_pr_create.API_VALUE_TAKING_FLAGS,
	)

	return subcommand === API_SUBCOMMAND && is_own_comments_endpoint(endpoint, resolve_own)
}

function is_comment_segment(segment: string, resolve_own: ResolveOwnRepository): boolean {
	const args = git_argv.arguments_of(segment, direct_pr_create.GH_COMMAND)

	if (args === undefined || direct_pr_create.is_help_call(args)) return false

	return is_comment_cli_call(args) || is_comment_api_call(args, resolve_own)
}

// `resolve_own` is injected so the suite fixes the checkout's repository without reading the real one.
function is_direct_issue_comment(
	command: string,
	resolve_own: ResolveOwnRepository = repo_party.current_repository,
): boolean {
	return direct_pr_create.has_run_segment(command, (segment) =>
		is_comment_segment(segment, resolve_own),
	)
}

// The row's trigger: the checkout's repository read under the hook call's own cwd and environment.
function is_direct_issue_comment_in(command: string, context: HookContext): boolean {
	return is_direct_issue_comment(command, () =>
		repo_party.current_repository(context.cwd, context.env),
	)
}

// `pnpm josh issue:comment` — the act that keeps the rule, segment-wise so a spelling quoted inside
// another command's body is not read as one.
const COMMENT_NAMES: ReadonlySet<string> = new Set(['issue:comment'])

function is_josh_comment(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, COMMENT_NAMES))
}

function is_any_comment(command: string): boolean {
	return is_direct_issue_comment(command) || is_josh_comment(command)
}

const DIRECT_ISSUE_COMMENT_REASON =
	'⛔ direct issue comment: `gh issue comment` (or a `gh api` write to `…/issues/<N>/comments`) posts ' +
	'without the run marker, so the run reads its own comment as a person updating the issue — the ' +
	'review goes stale and `pnpm josh followup` refuses the merge. Post with ' +
	'`pnpm josh issue:comment <N> --body-file <path>` instead (`shell-body.md`). ' +
	'**This rule fires on every occurrence, not once per run.**'

// **A standalone `gh issue comment <N> --body-file <path>` is rewritten rather than refused**
// (joshuafolkken/kit#7330): `issue:comment` reads the file as it is, so the posted text is the same and
// gains the run marker. The path is resolved against the call's cwd, since `pnpm josh` runs from the
// package root. An inline `--body` keeps the refusal: `issue:comment` trims it and expands `\n`, so the
// posted text could differ. So do stdin (`-`), a pipe, a chain, a quote and any other flag.
const COMMENT_WORDS = ['gh', ISSUE_GROUP, COMMENT_ACTION]
const BODY_FILE_SPELLING = /^(?:(?:-F|--body-file) |--body-file=)(?<file>[\w./-]+)$/u
const STDIN_PATH = '-'
const ISSUE_COMMENT_COMMAND = 'pnpm josh issue:comment'
const BODY_FILE_FLAG = '--body-file'

// The one body file the flags name, resolved against `cwd`, or `undefined` for any other spelling.
function body_file_of(flags: string, cwd: string): string | undefined {
	const file = BODY_FILE_SPELLING.exec(flags)?.groups?.['file']

	return file === undefined || file === STDIN_PATH ? undefined : path.resolve(cwd, file)
}

function issue_comment_of(comment: StandaloneCall, cwd: string): string | undefined {
	const resolved = body_file_of(comment.flags, cwd)

	return resolved !== undefined && standalone_gh_call.is_plain_word(resolved)
		? standalone_gh_call.line_of([ISSUE_COMMENT_COMMAND, comment.issue, BODY_FILE_FLAG, resolved])
		: undefined
}

// `pnpm josh issue:comment` for a refused post that is a standalone `gh issue comment`, else
// `undefined`. The word split runs first: it is cheap, and every Bash call passes through here.
function issue_comment_command(command: string, context: HookContext): string | undefined {
	const comment = standalone_gh_call.call_of(command, COMMENT_WORDS)
	const post = comment === undefined ? undefined : issue_comment_of(comment, context.cwd)

	return post !== undefined && is_direct_issue_comment_in(command.trim(), context)
		? post
		: undefined
}

function issue_comment_input(
	call: GuardedCall,
	_tail: () => string,
	context: HookContext,
): Record<string, unknown> | undefined {
	return standalone_gh_call.input_of(call, (command) => issue_comment_command(command, context))
}

const ISSUE_COMMENT_NOTE =
	'↻ direct issue comment: this `gh issue comment <N> --body-file <path>` ran as ' +
	'`pnpm josh issue:comment <N> --body-file <path>`, which posts the run marker (`shell-body.md`).'

const ROW = {
	id: 'direct-issue-comment',
	is_trigger: bash_triggers.on_bash_command(is_direct_issue_comment_in),
	reason: DIRECT_ISSUE_COMMENT_REASON,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(is_josh_comment),
	reaches: bash_triggers.on_bash_command(is_any_comment),
	rewrite: issue_comment_input,
	rewrite_note: ISSUE_COMMENT_NOTE,
	about: {
		title: 'Direct issue comment',
		topic: '`shell-body.md`',
		fires:
			"a comment to the checkout's own repository outside `josh issue:comment` (`gh issue comment` with no `--repo`, or a `gh api` write to `repos/<owner>/<r>/issues/<N>/comments` whose owner is the `{owner}` placeholder or the checkout's own `owner/repo` spelled out); it points at `pnpm josh issue:comment`. A line that is only `gh issue comment <N>` with one `--body-file` / `-F <path>` is rewritten to `pnpm josh issue:comment <N> --body-file <path>`; every other form is refused, every occurrence",
		quiet:
			'`pnpm josh issue:comment`, or reading the comments — the path that writes the run marker',
	},
}

const direct_issue_comment = {
	DIRECT_ISSUE_COMMENT_REASON,
	ISSUE_COMMENT_NOTE,
	ROW,
	is_direct_issue_comment,
	issue_comment_command,
}

export { direct_issue_comment }
