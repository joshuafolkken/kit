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

function is_pr_create_segment(segment: string): boolean {
	const args = git_argv.arguments_of(segment, GH_COMMAND)

	if (args === undefined) return false

	return is_pr_create_cli_call(args) || is_pr_create_api_call(args)
}

function is_direct_pr_create(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_pr_create_segment(segment))
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
}

const direct_pr_create = { DIRECT_PR_CREATE_REASON, ROW, is_direct_pr_create }

export { direct_pr_create }
