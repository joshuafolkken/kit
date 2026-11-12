import { git_argv } from '#scripts/rules/git-argv'
import {
	implementation_shell_deny_expansion as expansion,
	type Refusal,
} from './implementation-shell-deny-expansion'

// The git calls a consultation scope refuses before execution (joshuafolkken/kit#6586).

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
const QUOTES = /['"\\]/gu

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

// A read spelling holds only when every argument is literal: an expanded one may be `-D` or `expire`.
function is_git_write(subcommand: string, args: ReadonlyArray<string>): boolean {
	if (GIT_WRITES.has(subcommand)) return true

	const read_form = GIT_READ_FORMS.get(subcommand)
	if (read_form === undefined) return false

	return args.some((argument) => expansion.is_dynamic(argument)) || !read_form(args)
}

// A quoted program runs as the bare one: `"git" push` is `git push`.
function parsed_git(segment: string): ReturnType<typeof git_argv.parse> {
	return git_argv.parse(segment) ?? git_argv.parse(segment.replaceAll(QUOTES, ''))
}

// A quoted subcommand runs as the bare one too: `git 'push'` is `git push`.
function subcommand_refusal(segment: string): Refusal {
	const call = parsed_git(segment)
	if (call?.subcommand === undefined) return undefined
	if (expansion.is_dynamic(call.subcommand)) return expansion.refusal('git', call.subcommand)

	const subcommand = call.subcommand.replaceAll(QUOTES, '')
	const args = call.args.map((argument) => argument.replaceAll(QUOTES, ''))

	return is_git_write(subcommand, args) ? `\`git ${subcommand}\`, a git write` : undefined
}

function refusal(segment: string, args: ReadonlyArray<string>): Refusal {
	if (args.some((argument) => GIT_WRITE_FLAGS.test(argument))) {
		return 'a git option that rewrites its configuration, runs a program or writes a file'
	}

	return subcommand_refusal(segment)
}

const implementation_shell_deny_git = { refusal }

export { implementation_shell_deny_git }
