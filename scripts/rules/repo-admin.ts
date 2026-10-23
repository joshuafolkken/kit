import { bash_triggers } from './bash-triggers'
import { direct_pr_create } from './direct-pr-create'
import { gh_api } from './gh-api'
import { git_argv } from './git-argv'
import { pr_merge } from './pr-merge'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `repo-admin` row of `delivered-rules.ts`: a write to
// the repository's own administration — the rulesets and branch protection, the collaborators and
// their invitations, the secrets and variables, the webhooks and deploy keys, and the repository's
// settings. The server-side ruleset is one of the two real boundaries of an unattended run, and the
// trust gate reads write permission, so one injected call that adds a collaborator or disables the
// ruleset hands the backlog to an attacker (joshuafolkken/kit#4650).
//
// **A `DELETE` is `destructive-command`'s**, which refuses every `DELETE repos/…` already; this row
// takes the other write methods, so one row claims each call. `gh ruleset` has no write subcommand.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const GH_COMMAND = 'gh'
const DELETE_METHOD = 'DELETE'
const PATCH_METHOD = 'PATCH'

// `repos/<o>/<r>` as a path or a full URL (`https://api.github.com/repos/…`), anchored on the whole
// argument so a path smuggled into a field value (`-f x=repos/…/hooks`) is not read as the endpoint.
const REPOSITORY_PREFIX = String.raw`^['"]?(?:https?:\/\/[^/\s'"]+)?\/?repos\/[^/\s'"]+\/[^/\s'"]+`
// The administration endpoints under it — the environments whole, since their protection rules move
// the deployment boundary as their secrets do.
const ADMIN_PATH = new RegExp(
	REPOSITORY_PREFIX +
		String.raw`\/(?:rulesets|branches\/[^\s'"]+\/protection|collaborators|invitations|hooks|keys|` +
		String.raw`transfer|actions\/permissions|environments|` +
		String.raw`(?:actions|dependabot|codespaces)\/(?:secrets|variables))(?:[/?'"]|$)`,
	'u',
)
// The repository itself — a `PATCH` here edits its settings (visibility, default branch, merge rules).
const REPOSITORY_BODY = new RegExp(String.raw`${REPOSITORY_PREFIX}\/?['"]?$`, 'u')
// The GraphQL mutations that do what the endpoints above do. Looked for in the whole line, as
// `pr-merge.ts` does, since the segment cut ignores quotes; a body read from a file is `pr-merge`'s.
const ADMIN_MUTATIONS =
	/\b(?:updateRepository|archiveRepository|(?:create|update|delete)(?:BranchProtectionRule|RepositoryRuleset|Environment))\b/u

function is_admin_target(argument: string, method: string | undefined): boolean {
	return ADMIN_PATH.test(argument) || (method === PATCH_METHOD && REPOSITORY_BODY.test(argument))
}

function is_admin_graphql_call(command: string, args: ReadonlyArray<string>): boolean {
	return pr_merge.is_graphql_call(GH_COMMAND, args) && ADMIN_MUTATIONS.test(command)
}

// Judged on the call with its wrapper cut off, as `destructive-command.ts` does.
function is_admin_api_call(command: string, args: ReadonlyArray<string>): boolean {
	const call = [GH_COMMAND, ...args].join(' ')

	if (!gh_api.is_gh_api(call) || !gh_api.is_write(call)) return false
	if (is_admin_graphql_call(command, args)) return true

	const method = gh_api.method_of(call)

	if (method === DELETE_METHOD) return false

	return args.some((argument) => is_admin_target(argument, method))
}

// The read subcommands of the groups whose every other subcommand writes.
const READ_ACTIONS: ReadonlySet<string> = new Set(['list', 'ls', 'get', 'view'])
const ACTION_POSITION = 1
const SUB_ACTION_POSITION = 2
// Where the word that decides read vs write sits, keyed by the group (`gh secret <verb>`) or by the
// group and action (`gh repo deploy-key <verb>`); `gh repo edit` is its own verb and only writes.
const VERB_POSITIONS: ReadonlyMap<string, number> = new Map([
	['secret', ACTION_POSITION],
	['variable', ACTION_POSITION],
	['repo edit', ACTION_POSITION],
	['repo deploy-key', SUB_ACTION_POSITION],
])

// The verb of an administration subcommand, or `undefined` for every other call. Read off the
// positional words, so a repository selector before the group (`gh -R o/r secret set`) is skipped.
function admin_verb(args: ReadonlyArray<string>): string | undefined {
	const words = direct_pr_create.positional_words(args, direct_pr_create.API_VALUE_TAKING_FLAGS)
	const position =
		VERB_POSITIONS.get(words[0] ?? '') ??
		VERB_POSITIONS.get(words.slice(0, SUB_ACTION_POSITION).join(' '))

	if (position === undefined) return undefined

	return words[position] ?? ''
}

function is_admin_cli_call(args: ReadonlyArray<string>): boolean {
	const verb = admin_verb(args)

	return verb !== undefined && !READ_ACTIONS.has(verb)
}

function is_admin_segment(command: string, segment: string): boolean {
	const args = git_argv.arguments_of(segment, GH_COMMAND)

	if (args === undefined) return false

	return is_admin_cli_call(args) || is_admin_api_call(command, args)
}

function is_repo_admin_write(command: string): boolean {
	return shell_segments.commands_of(command).some((segment) => is_admin_segment(command, segment))
}

const REPO_ADMIN_REASON =
	'⛔ repository administration: a write to the rulesets, branch protection, collaborators, ' +
	'invitations, secrets, variables, webhooks, deploy keys or repository settings moves the ' +
	'boundary an unattended run relies on, which is Tier C. Ask the user to run it. It fires on every occurrence ' +
	'(`prompts/collaboration-workflow/operating-rules.md`).'

const ROW = {
	id: 'repo-admin',
	is_trigger: bash_triggers.on_bash_command(is_repo_admin_write),
	reason: REPO_ADMIN_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Repository administration',
		topic: '`operating-rules.md`',
		fires:
			'a `gh api` POST / PUT / PATCH (path or URL) to the rulesets, branch protection, collaborators, invitations, secrets, variables, hooks, keys, environments, actions permissions or transfer, a `PATCH` of the repository, the matching GraphQL mutations, `gh secret` / `gh variable` writes, `gh repo edit` / `deploy-key` writes. Every occurrence',
		quiet:
			'`gh secret list`, `gh variable get`, a `gh api` read — a `DELETE` is `destructive-command`',
	},
}

const repo_admin = { REPO_ADMIN_REASON, ROW, is_repo_admin_write }

export { repo_admin }
