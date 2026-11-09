import { canonical_command } from '#scripts/josh/josh-aliases'
import { josh_read_only } from '#scripts/josh/josh-read-only'
import { gh_api } from '#scripts/rules/gh-api'
import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'

// The calls a consultation scope refuses before execution (joshuafolkken/kit#6586): the ones no
// later check can take back. Every other call runs — a runtime file it changes is restored after the
// call (`bash-revert.ts`), but a ref, the shared stash, a GitHub record or an installed dependency is
// not a runtime file.

type Refusal = string | undefined

// Subcommands that move a ref, the index, the worktree or the shared stash in every spelling.
const GIT_WRITES: ReadonlySet<string> = new Set([
	'add',
	'am',
	'apply',
	'bisect',
	'checkout',
	'checkout-index',
	'cherry-pick',
	'clean',
	'commit',
	'credential',
	'fetch',
	'filter-branch',
	'gc',
	'init',
	'maintenance',
	'merge',
	'mv',
	'pack-refs',
	'prune',
	'prune-packed',
	'pull',
	'push',
	'read-tree',
	'rebase',
	'repack',
	'replace',
	'reset',
	'restore',
	'revert',
	'rm',
	'send-email',
	'sparse-checkout',
	'stage',
	'submodule',
	'switch',
	'symbolic-ref',
	'update-index',
	'update-ref',
])
const BRANCH_CHANGE =
	/^--(?:delete|move|copy|force|set-upstream-to|unset-upstream|edit-description)/u
const BRANCH_CHANGE_LETTERS = 'dDmMcCfu'
const CONFIG_READ = /^(?:--get|--list$|-l$)/u
// The flags that put `git branch` / `git tag` in list mode, where a name is a pattern, not a new ref.
const LIST_MODE =
	/^(?:-l$|--list$|-n\d*$|--contains|--no-contains|--points-at|--merged|--no-merged)/u
// List flags whose value is the next word, so the value is not read as a new ref's name.
const LIST_VALUE_FLAGS: ReadonlySet<string> = new Set(['--sort', '--format'])
const REFLOG_WRITES: ReadonlySet<string> = new Set(['expire', 'delete'])
// A global that rewrites git's configuration or launcher, or an option that writes a file or runs one.
const GIT_WRITE_FLAGS = /^-c$|^--(?:config-env|exec-path|output|ext-diff|textconv)/u
// A word the shell expands before the call, so it may spell any subcommand or flag.
const DYNAMIC = /[$`]/u
const QUOTES = /['"\\]/gu

function is_dynamic(word: string): boolean {
	return DYNAMIC.test(word)
}

function is_branch_change(argument: string): boolean {
	return BRANCH_CHANGE.test(argument) || git_argv.short_cluster_has(argument, BRANCH_CHANGE_LETTERS)
}

function names_a_reference(args: ReadonlyArray<string>): boolean {
	return args.some(
		(argument, index) => !argument.startsWith('-') && !LIST_VALUE_FLAGS.has(args[index - 1] ?? ''),
	)
}

// `git branch` / `git tag` only list when no word names a new ref, or a flag puts them in list mode.
function is_listing(args: ReadonlyArray<string>): boolean {
	return !names_a_reference(args) || args.some((argument) => LIST_MODE.test(argument))
}

// Subcommands with a read spelling: the predicate says whether the arguments only read.
const GIT_READ_FORMS: ReadonlyMap<string, (args: ReadonlyArray<string>) => boolean> = new Map([
	['branch', (args) => is_listing(args) && args.every((argument) => !is_branch_change(argument))],
	['stash', (args) => ['list', 'show'].includes(args[0] ?? '')],
	['worktree', (args) => args[0] === 'list'],
	['notes', (args) => ['list', 'show'].includes(args[0] ?? '')],
	['remote', (args) => ['', '-v', 'show', 'get-url'].includes(args[0] ?? '')],
	['config', (args) => args.some((argument) => CONFIG_READ.test(argument))],
	['tag', is_listing],
	['reflog', (args) => !REFLOG_WRITES.has(args[0] ?? '')],
])

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

function expansion_refusal(program: string, word: string): string {
	return `\`${program} ${word}\`, an expansion that may spell a write`
}

// A read spelling holds only when every argument is literal: an expanded one may be `-D` or `expire`.
function is_git_write(subcommand: string, args: ReadonlyArray<string>): boolean {
	if (GIT_WRITES.has(subcommand)) return true

	const read_form = GIT_READ_FORMS.get(subcommand)
	if (read_form === undefined) return false

	return args.some((argument) => is_dynamic(argument)) || !read_form(args)
}

// A quoted program runs as the bare one: `"git" push` is `git push`.
function parsed_git(segment: string): ReturnType<typeof git_argv.parse> {
	return git_argv.parse(segment) ?? git_argv.parse(segment.replaceAll(QUOTES, ''))
}

// A quoted subcommand runs as the bare one too: `git 'push'` is `git push`.
function subcommand_refusal(segment: string): Refusal {
	const call = parsed_git(segment)
	if (call?.subcommand === undefined) return undefined
	if (is_dynamic(call.subcommand)) return expansion_refusal('git', call.subcommand)

	const subcommand = call.subcommand.replaceAll(QUOTES, '')
	const args = call.args.map((argument) => argument.replaceAll(QUOTES, ''))

	return is_git_write(subcommand, args) ? `\`git ${subcommand}\`, a git write` : undefined
}

function git_refusal(segment: string, args: ReadonlyArray<string>): Refusal {
	if (args.some((argument) => GIT_WRITE_FLAGS.test(argument))) {
		return 'a git option that rewrites its configuration, runs a program or writes a file'
	}

	return subcommand_refusal(segment)
}

function is_gh_api_write(args: ReadonlyArray<string>): boolean {
	if (args.includes('graphql')) return args.some((argument) => GRAPHQL_MUTATION.test(argument))

	return gh_api.is_write(['gh', ...args].join(' '))
}

function is_gh_verb(argument: string): boolean {
	return GH_WRITES.has(argument) || GH_READS.has(argument) || is_dynamic(argument)
}

function verb_refusal(group: string, args: ReadonlyArray<string>): Refusal {
	const verb = args.slice(1).find((argument) => is_gh_verb(argument))
	if (verb === undefined || GH_READS.has(verb)) return undefined

	return is_dynamic(verb)
		? expansion_refusal(`gh ${group}`, verb)
		: `\`gh ${group} ${verb}\`, a GitHub write`
}

function gh_refusal(args: ReadonlyArray<string>): Refusal {
	const group = args[0] ?? ''
	if (group === 'api') return is_gh_api_write(args) ? 'a `gh api` call other than GET' : undefined

	return is_dynamic(group) ? expansion_refusal('gh', group) : verb_refusal(group, args)
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
	if (is_dynamic(action)) return expansion_refusal(manager, action)

	return PACKAGE_WRITES.has(action) ? `\`${action}\`, a dependency change` : undefined
}

function package_refusal(call: ProgramCall): Refusal {
	return package_actions(call)
		.map((action) => action_refusal(call.name, action))
		.find((rule) => rule !== undefined)
}

function josh_refusal(args: ReadonlyArray<string>): Refusal {
	const command = canonical_command(args[0] ?? '')
	if (is_dynamic(command)) return expansion_refusal('josh', command)
	if (!JOSH_SHARED_WRITES.has(command)) return undefined

	const rule = josh_read_only.refusal(args)

	return rule === undefined ? undefined : `\`josh ${command}\`, a shared-state write: ${rule}`
}

// The irreversible operation the call is, or `undefined` when it runs.
function refusal(segment: string, call: ProgramCall): Refusal {
	if (is_dynamic(call.name)) return `\`${call.name}\`, a program an expansion names`
	if (call.name === 'git') return git_refusal(segment, call.args)
	if (call.name === 'gh') return gh_refusal(call.args)
	if (call.name === 'josh') return josh_refusal(call.args)

	return package_refusal(call)
}

const implementation_shell_deny = { refusal }

export { implementation_shell_deny }
