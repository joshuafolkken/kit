import { direct_pr_create } from './direct-pr-create'
import { git_argv } from './git-argv'

// The `gh <group> <action> -R <owner>/<repo>` reading the third-party-write guard needs
// (joshuafolkken/kit#4659). `gh pr create -R other/x` and `gh issue comment -R other/x` write to the
// repository the selector names, so a guard that judged only `gh api`'s `repos/<owner>/` path let
// every such write through.
//
// **A write unless it is a known read.** The read actions are few and stable; the write actions are
// many and grow with `gh`. Listing the reads makes a new write subcommand refused by default instead
// of passed by default.

const GH_COMMAND = 'gh'
const API_GROUP = 'api'
const SELECTOR_FLAGS: ReadonlySet<string> = new Set(['-R', '--repo'])
const ATTACHED_SELECTOR = /^(?:-R=?|--repo=)(.+)$/u
const QUOTES = /['"]/gu
const NEXT = 1
// Groups that never write with a selector, whatever follows them.
const READ_GROUPS: ReadonlySet<string> = new Set(['browse', 'search', 'status'])
const READ_ACTIONS: ReadonlySet<string> = new Set([
	'check',
	'checkout',
	'checks',
	'clone',
	'diff',
	'download',
	'get',
	'list',
	'status',
	'verify',
	'verify-asset',
	'view',
	'watch',
])
// `GH_REPO=<selector>` — inline before `gh`, or exported earlier in the line — selects the repository
// exactly as `-R` does.
const GH_REPO_ASSIGNMENT = /(?:^|\s)GH_REPO=(\S+)/gu
const SELECTOR_GROUP = 1

function selector_value(word: string, next: string | undefined): string | undefined {
	if (SELECTOR_FLAGS.has(word)) return next

	return ATTACHED_SELECTOR.exec(word)?.[1]
}

// Every `-R` / `--repo` value the call carries, quotes stripped. Each is a repository `gh` may send
// the write to, so the caller judges all of them rather than guessing which one `gh` keeps.
function selectors_of(args: ReadonlyArray<string>): Array<string> {
	return args
		.map((word, index) => selector_value(word, args[index + NEXT]))
		.filter((value) => value !== undefined)
		.map((value) => value.replaceAll(QUOTES, ''))
}

function is_write_call(args: ReadonlyArray<string>): boolean {
	const [group = '', action = ''] = direct_pr_create.positional_words(args, SELECTOR_FLAGS)

	if (group === API_GROUP || READ_GROUPS.has(group)) return false

	return !READ_ACTIONS.has(action)
}

// Every `GH_REPO` value assigned in `segments` — the write's own segment and those before it.
function assigned_selectors(segments: ReadonlyArray<string>): Array<string> {
	return segments
		.flatMap((segment) => [...segment.matchAll(GH_REPO_ASSIGNMENT)])
		.map((match) => (match[SELECTOR_GROUP] ?? '').replaceAll(QUOTES, ''))
}

// The repository selectors of the `gh` write at `index` — its `-R` / `--repo` values and every
// `GH_REPO` assigned up to it — or none when the segment is not `gh`, is a `gh api` call (judged by
// its path), is a read, or names no selector.
function write_selectors(segments: ReadonlyArray<string>, index: number): Array<string> {
	const args = git_argv.arguments_of(segments[index] ?? '', GH_COMMAND)

	if (args === undefined || !is_write_call(args)) return []

	return [...selectors_of(args), ...assigned_selectors(segments.slice(0, index + NEXT))]
}

const gh_repo_selector = { write_selectors }

export { gh_repo_selector }
