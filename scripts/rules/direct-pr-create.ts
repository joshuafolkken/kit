import { bash_triggers } from './bash-triggers'
import { gh_api } from './gh-api'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `direct-pr-create` row of `delivered-rules.ts`.
// A PR opened outside `pnpm josh pr` skips `build_body`, which writes the
// `closes #N` line — so the Issue stays open after the merge. `CLAUDE.md` forbade the call in prose
// only; this row reads the argv instead, through `git-argv.ts`'s wrapper cut, so `env gh pr create`
// is seen too. `pnpm josh pr` itself is never claimed: its first word after the wrapper is `pnpm`,
// and the `gh api` call it makes runs inside the script, not as a `Bash` command.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const GH_COMMAND = 'gh'
const PR_GROUP = 'pr'
// `new` is gh's own alias for `pr create`.
const PR_CREATE_ACTIONS: ReadonlySet<string> = new Set(['create', 'new'])
const FLAG_PREFIX = '-'
const HELP_FLAGS: ReadonlySet<string> = new Set(['-h', '--help'])
// The repository selector gh accepts before `pr` or between `pr` and its action; with no `=` it
// swallows the next word, so that word is not read as the group or the action.
const VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set(['-R', '--repo'])
// `gh api`'s own flags that take a value as the next word, beside the repository selector — skipped
// so `-X POST` or `-f body=…` is not read as the endpoint.
const API_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
	...VALUE_TAKING_FLAGS,
	'-X',
	'--method',
	'-f',
	'--raw-field',
	'-F',
	'--field',
	'-H',
	'--header',
	'--input',
	'-q',
	'--jq',
	'-t',
	'--template',
	'--hostname',
	'-p',
	'--preview',
	'--cache',
])
const API_SUBCOMMAND = 'api'
// The pull-request collection itself — a write there opens a PR. Anchored on the whole endpoint
// argument, so `…/pulls/5/comments` is not read as the collection. A full API URL names the same
// endpoint.
const PULLS_PATH =
	/^['"]?(?:https:\/\/api\.github\.com)?\/?repos\/[^/\s'"]+\/[^/\s'"]+\/pulls\/?['"]?$/u

// The words that are neither a flag nor a value-taking flag's value, so `gh -R o/r pr create` and
// `gh pr --repo o/r create` reach the same `pr` / `create` pair as the bare spelling.
function positional_words(
	args: ReadonlyArray<string>,
	value_taking_flags: ReadonlySet<string>,
): Array<string> {
	return args.filter((argument, index) => {
		if (argument.startsWith(FLAG_PREFIX)) return false

		return !value_taking_flags.has(args[index - 1] ?? '')
	})
}

// Only the endpoint — the first positional word after `api` — is tested, so a field value that
// happens to spell the collection path (`-f body='… repos/o/r/pulls'`) is not read as the target.
function is_pr_create_api_call(args: ReadonlyArray<string>): boolean {
	const call = [GH_COMMAND, ...args].join(' ')

	if (!gh_api.is_gh_api(call) || !gh_api.is_write(call)) return false

	const [subcommand, endpoint = ''] = positional_words(args, API_VALUE_TAKING_FLAGS)

	return subcommand === API_SUBCOMMAND && PULLS_PATH.test(endpoint)
}

function is_pr_create_cli_call(args: ReadonlyArray<string>): boolean {
	const [group, action = ''] = positional_words(args, VALUE_TAKING_FLAGS)

	return group === PR_GROUP && PR_CREATE_ACTIONS.has(action)
}

// A help call prints the usage and creates nothing. A help flag right after another flag may be that
// flag's value (`--title -h`), so it is not read as one — a boolean flag before it errs toward refusal.
function is_help_call(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument, index) =>
			HELP_FLAGS.has(argument) && !(args[index - 1] ?? '').startsWith(FLAG_PREFIX),
	)
}

function is_pr_create_segment(segment: string): boolean {
	const args = git_argv.arguments_of(segment, GH_COMMAND)

	if (args === undefined || is_help_call(args)) return false

	return is_pr_create_cli_call(args) || is_pr_create_api_call(args)
}

// Quoted text the shell still runs: a command substitution, or the string `sh -c` (its `-c` alone or
// in a cluster such as `-lc`, after any other flags), `ssh` or `eval` executes. `ssh` and `eval` count
// only as the segment's program, so `grep -E "ssh|gh pr create"` stays one quoted pattern.
const RUNS_QUOTED_TEXT = /\$\(|`/u
const QUOTED_TEXT_RUNNERS: ReadonlySet<string> = new Set(['ssh', 'eval'])
const SHELL_DASH_C = /\b(?:ba|da|k|z)?sh\s+(?:-\S+\s+)*-[A-Za-z]*c\b/u
// A `#` comment hides its apostrophe from the shell but not from the quote pairing, so a multi-line
// segment holding one may be lines the pairing joined (`# don't` … `'`) rather than one quoted span.
const COMMENT_MARKER = /(?:^|\s)#/mu
const LINE_BREAK = '\n'

function is_run_by_shell(segment: string): boolean {
	if (RUNS_QUOTED_TEXT.test(segment) || SHELL_DASH_C.test(segment)) return true

	return QUOTED_TEXT_RUNNERS.has(git_argv.program_of(segment)?.name ?? '')
}

function is_runs_quoted_text(segment: string): boolean {
	if (is_run_by_shell(segment)) return true

	return segment.includes(LINE_BREAK) && COMMENT_MARKER.test(segment)
}

// A segment whose quotes still run keeps the plain cut, so `bash -c 'git push && gh pr create --fill'`
// is refused as it was before the quote-aware cut.
function judged_segments(segment: string): Array<string> {
	return is_runs_quoted_text(segment) ? shell_segments.commands_of(segment) : [segment]
}

// The cut is quote-aware, so `grep -E "a|gh pr create|b"` stays one `grep` call rather than yielding
// a `gh pr create` segment from inside its pattern (joshuafolkken/kit#4091). Shared with the
// `direct-issue-comment` row, which judges a `gh` call by the same cut.
function has_run_segment(command: string, is_match: (segment: string) => boolean): boolean {
	return shell_segments
		.quote_aware_commands_of(command)
		.flatMap((segment) => judged_segments(segment))
		.some((segment) => is_match(segment))
}

function is_direct_pr_create(command: string): boolean {
	return has_run_segment(command, is_pr_create_segment)
}

const DIRECT_PR_CREATE_REASON =
	'⛔ direct PR creation: `gh pr create` (or a `gh api` POST to `repos/<o>/<r>/pulls`) bypasses ' +
	'`build_body`, which writes the `closes #N` line — the Issue would stay open after the merge ' +
	'(`CLAUDE.md` → Git Rules). Open the PR with `pnpm josh pr` instead; after a failed push, fix, push, ' +
	'then run `pnpm josh pr`. **This rule fires on every occurrence, not once per run.**'

const ROW = {
	id: 'direct-pr-create',
	is_trigger: bash_triggers.on_bash_command(is_direct_pr_create),
	reason: DIRECT_PR_CREATE_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Direct PR creation',
		topic: '`CLAUDE.md` → Git Rules',
		fires:
			'`gh pr create`, or a `gh api` write to `repos/<o>/<r>/pulls`; it points at `pnpm josh pr`. Every occurrence',
		quiet: '`pnpm josh pr`, or reading a PR — the path that writes `closes #N`',
	},
}

const direct_pr_create = {
	API_VALUE_TAKING_FLAGS,
	DIRECT_PR_CREATE_REASON,
	GH_COMMAND,
	ROW,
	VALUE_TAKING_FLAGS,
	has_run_segment,
	is_direct_pr_create,
	is_help_call,
	positional_words,
}

export { direct_pr_create }
