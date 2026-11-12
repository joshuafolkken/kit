import { canonical_command } from '#scripts/josh/josh-aliases'
import { josh_read_only } from '#scripts/josh/josh-read-only'
import { gh_api } from '#scripts/rules/gh-api'
import type { ProgramCall } from '#scripts/rules/git-argv'
import {
	implementation_shell_deny_expansion as expansion,
	type Refusal,
} from './implementation-shell-deny-expansion'
import { implementation_shell_deny_git } from './implementation-shell-deny-git'

// The calls a consultation scope refuses before execution (joshuafolkken/kit#6586): the ones no
// later check can take back. Every other call runs — a runtime file it changes is restored after the
// call (`bash-revert.ts`), but a ref, the shared stash, a GitHub record or an installed dependency is
// not a runtime file.

// A verb that changes a GitHub record or the checkout. The first verb after the group is the call's,
// so a flag between the group and the verb (`gh issue -R o/r close`) does not hide it, and a read
// verb's argument (`gh issue list --search close`) is not read as one.
const GH_READS: ReadonlySet<string> = new Set([
	'checks',
	'code',
	'commits',
	'diff',
	'issues',
	'list',
	'prs',
	'repos',
	'status',
	'token',
	'view',
	'watch',
])
const GH_WRITES: ReadonlySet<string> = new Set([
	'add',
	'archive',
	'cancel',
	'checkout',
	'clone',
	'close',
	'comment',
	'copy',
	'create',
	'delete',
	'develop',
	'disable',
	'edit',
	'enable',
	'field-create',
	'field-delete',
	'fork',
	'install',
	'item-add',
	'item-archive',
	'item-create',
	'item-delete',
	'item-edit',
	'link',
	'lock',
	'login',
	'logout',
	'mark-template',
	'merge',
	'pin',
	'ready',
	'refresh',
	'remove',
	'rename',
	'reopen',
	'rerun',
	'revert',
	'review',
	'run',
	'set',
	'setup-git',
	'sync',
	'transfer',
	'unarchive',
	'unlink',
	'unlock',
	'unpin',
	'update-branch',
	'upgrade',
	'upload',
])
// A GraphQL query is a POST that only reads; a mutation is named as one. A query read from a file
// (`-F query=@q.graphql`, `--input`) is not readable here, so it counts as a mutation.
const GRAPHQL_MUTATION = /\bmutation\b|=@|^--input/u

const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'yarn'])
// `pnpm` is a wrapper the program cut skips, so `pnpm install` reaches here as the program `install`.
const PACKAGE_WRITES: ReadonlySet<string> = new Set([
	'add',
	'ci',
	'dedupe',
	'i',
	'install',
	'link',
	'patch-commit',
	'publish',
	'rebuild',
	'remove',
	'un',
	'uninstall',
	'unlink',
	'unpublish',
	'up',
	'update',
	'upgrade',
	// Commits and tags the version bump.
	'version',
])

// The josh commands that commit, push, merge, publish, change dependencies or move the shared
// stash. One of them passes only on a read-only spelling its entry declares (`ship --log`).
const JOSH_SHARED_WRITES: ReadonlySet<string> = new Set([
	'adopt',
	'bump',
	'dogfood:commit',
	'followup',
	'git',
	'init',
	'latest',
	'latest:corepack',
	'latest:update',
	'overrides',
	'pr',
	'release',
	'release:github',
	'ship',
	'stash:pop',
	'stash:push',
	'sync',
	'uninstall',
])

function is_gh_api_write(args: ReadonlyArray<string>): boolean {
	if (args.includes('graphql')) return args.some((argument) => GRAPHQL_MUTATION.test(argument))

	return gh_api.is_write(['gh', ...args].join(' '))
}

function is_gh_verb(argument: string): boolean {
	return GH_WRITES.has(argument) || GH_READS.has(argument) || expansion.is_dynamic(argument)
}

function verb_refusal(group: string, args: ReadonlyArray<string>): Refusal {
	const verb = args.slice(1).find((argument) => is_gh_verb(argument))
	if (verb === undefined || GH_READS.has(verb)) return undefined

	return expansion.is_dynamic(verb)
		? expansion.refusal(`gh ${group}`, verb)
		: `\`gh ${group} ${verb}\`, a GitHub write`
}

function gh_refusal(args: ReadonlyArray<string>): Refusal {
	const group = args[0] ?? ''
	if (group === 'api') return is_gh_api_write(args) ? 'a `gh api` call other than GET' : undefined

	return expansion.is_dynamic(group) ? expansion.refusal('gh', group) : verb_refusal(group, args)
}

function is_flag(argument: string): boolean {
	return argument.startsWith('-')
}

// A word after a bare flag may be that flag's value (`npm --prefix web install`), so it does not end
// the walk for the action.
function is_action_word(args: ReadonlyArray<string>, index: number): boolean {
	const previous = args[index - 1] ?? ''

	return !is_flag(args[index] ?? '-') && (!is_flag(previous) || previous.includes('='))
}

// The words that may be the manager's action, up to the first no flag precedes; `yarn` with none
// installs.
function package_actions(call: ProgramCall): Array<string> {
	if (!PACKAGE_MANAGERS.has(call.name)) return [call.name]

	const end = call.args.findIndex((_argument, index) => is_action_word(call.args, index))
	const read = end === -1 ? call.args : call.args.slice(0, end + 1)
	const actions = read.filter((word) => !is_flag(word))

	return end === -1 && call.name === 'yarn' ? [...actions, 'install'] : actions
}

function action_refusal(manager: string, action: string): Refusal {
	if (expansion.is_dynamic(action)) return expansion.refusal(manager, action)

	return PACKAGE_WRITES.has(action) ? `\`${action}\`, a dependency change` : undefined
}

function package_refusal(call: ProgramCall): Refusal {
	return package_actions(call)
		.map((action) => action_refusal(call.name, action))
		.find((rule) => rule !== undefined)
}

function josh_refusal(args: ReadonlyArray<string>): Refusal {
	const command = canonical_command(args[0] ?? '')
	if (expansion.is_dynamic(command)) return expansion.refusal('josh', command)
	if (!JOSH_SHARED_WRITES.has(command)) return undefined

	const rule = josh_read_only.refusal(args)

	return rule === undefined ? undefined : `\`josh ${command}\`, a shared-state write: ${rule}`
}

// The irreversible operation the call is, or `undefined` when it runs.
function refusal(segment: string, call: ProgramCall): Refusal {
	if (expansion.is_dynamic(call.name)) return `\`${call.name}\`, a program an expansion names`
	if (call.name === 'git') return implementation_shell_deny_git.refusal(segment, call.args)
	if (call.name === 'gh') return gh_refusal(call.args)
	if (call.name === 'josh') return josh_refusal(call.args)

	return package_refusal(call)
}

const implementation_shell_deny = { refusal }

export { implementation_shell_deny }
