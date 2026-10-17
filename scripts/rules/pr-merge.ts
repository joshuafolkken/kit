import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `pr-merge` row of `delivered-rules.ts`: a pull
// request merged by the agent's own `Bash` call. A merge is Tier C, and the one authorized route is
// `pnpm josh followup` (and `pnpm josh observations:flush`), which merges inside its own process —
// the word after the wrapper is `josh`, so neither is claimed here.
//
// **The deny list matches globs; this reads the program.** `Bash(gh pr merge*)` and
// `Bash(gh api *pulls/*/merge*)` miss `curl -X PUT …/pulls/5/merge`, a GraphQL body read from a file
// (`gh api graphql -F query=@merge.graphql`), and `enablePullRequestAutoMerge`, which merges once
// the checks pass. A body kept in a file cannot be read here, so a file-sourced GraphQL call is
// refused whatever it holds — kit's own GitHub calls are REST (`gh-rest.md`).
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const GH_COMMAND = 'gh'
const CURL_COMMAND = 'curl'
const PR_GROUP = 'pr'
const MERGE_ACTION = 'merge'
const API_SUBCOMMAND = 'api'
const GRAPHQL_ENDPOINT = 'graphql'
// The REST merge endpoint, in any spelling of the number (`5`, `$N`, `${PR}`).
const MERGE_PATH = /pulls\/[^/\s'"]+\/merge(?![\w-])/u
const MERGE_MUTATIONS = /\b(?:mergePullRequest|enablePullRequestAutoMerge)\b/u
const GRAPHQL_URL = /\/graphql\b/u
// A body read from a file or stdin: `@file` / `field=@file` for `gh api -F` and curl's `-d`, a
// short flag with the value attached (`-d@file`), and the flags that upload a whole file.
const FILE_BODY_VALUE = /^(?:-[A-Za-z]|[^=\s]*=)?['"]?@/u
const FILE_BODY_FLAGS: ReadonlySet<string> = new Set(['--input', '-T', '--upload-file'])

// The words that are neither a flag nor a flag's value, with `gh api`'s value-taking flags, so
// `gh api -X POST graphql` reaches `graphql` as the endpoint.
function positional_words(args: ReadonlyArray<string>): Array<string> {
	return direct_pr_create.positional_words(args, direct_pr_create.API_VALUE_TAKING_FLAGS)
}

function is_pr_merge_cli_call(args: ReadonlyArray<string>): boolean {
	const [group, action] = positional_words(args)

	return group === PR_GROUP && action === MERGE_ACTION
}

function is_github_api_call(name: string, args: ReadonlyArray<string>): boolean {
	if (name === CURL_COMMAND) return true

	return name === GH_COMMAND && positional_words(args)[0] === API_SUBCOMMAND
}

// `gh api` reaches GraphQL through its `graphql` endpoint or, like curl, through the `/graphql` path
// or URL (`gh api /graphql --input body.json`).
function is_graphql_call(name: string, args: ReadonlyArray<string>): boolean {
	if (args.some((argument) => GRAPHQL_URL.test(argument))) return true

	return name === GH_COMMAND && positional_words(args)[1] === GRAPHQL_ENDPOINT
}

function reads_body_from_file(args: ReadonlyArray<string>): boolean {
	return args.some((argument) => FILE_BODY_FLAGS.has(argument) || FILE_BODY_VALUE.test(argument))
}

function is_api_merge(segment: string, name: string, args: ReadonlyArray<string>): boolean {
	if (MERGE_PATH.test(segment) || MERGE_MUTATIONS.test(segment)) return true

	return is_graphql_call(name, args) && reads_body_from_file(args)
}

function is_pr_merge_segment(segment: string): boolean {
	const call = git_argv.program_of(segment)

	if (call === undefined) return false
	if (call.name === GH_COMMAND && is_pr_merge_cli_call(call.args)) return true

	return is_github_api_call(call.name, call.args) && is_api_merge(segment, call.name, call.args)
}

function is_pr_merge(command: string): boolean {
	return shell_segments.commands_of(command).some((segment) => is_pr_merge_segment(segment))
}

const PR_MERGE_REASON =
	'⛔ direct PR merge: `gh pr merge`, a `gh api` / `curl` call to `…/pulls/<N>/merge`, a ' +
	'`mergePullRequest` / `enablePullRequestAutoMerge` mutation, or a GraphQL body read from a file ' +
	'merges outside the verified route, and a merge is Tier C. Merge with `pnpm josh followup` when the ' +
	'run authorizes it; otherwise leave it to the user (`CLAUDE.md` → Git Rules). This rule fires on ' +
	'every occurrence.'

const ROW = {
	id: 'pr-merge',
	is_trigger: bash_triggers.on_bash_command(is_pr_merge),
	reason: PR_MERGE_REASON,
	decide: (): boolean => true,
}

const pr_merge = { PR_MERGE_REASON, ROW, is_pr_merge }

export { pr_merge }
