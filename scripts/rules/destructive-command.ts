import { bash_triggers } from './bash-triggers'
import { gh_api } from './gh-api'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `destructive-command` row of `delivered-rules.ts`:
// a recursive forced `rm`, and the `gh` calls that delete or close shared
// state — none of which the deny list stopped, or stopped only in one spelling (`Bash(rm -rf *)`
// misses `rm -fr`, `rm -r -f` and `rm --recursive --force`). The argv is read through `git-argv.ts`'s
// wrapper cut, so `sudo rm -fr` and `env gh pr close` are seen too.
//
// **What is refused is the decision recorded on the Issue, not every destructive act.** `gh issue
// close` passes — the WIP-cap procedure closes Issues legitimately — and so does removing a label from
// an Issue (`DELETE repos/<o>/<r>/issues/<N>/labels/<name>`), which the `in-progress` and
// `needs-decision` steps of the workflow documents issue. Every other `DELETE repos/…` is refused.
//
// **It fires on every occurrence**, for the reason `git-force.ts` does.

const RM_COMMAND = 'rm'
const RECURSIVE_LONG = '--recursive'
const RECURSIVE_LETTERS = 'rR'
const FORCE_LONG = '--force'
const FORCE_LETTER = 'f'

function has_flag(args: ReadonlyArray<string>, long: string, letters: string): boolean {
	return args.some((argument) => argument === long || git_argv.short_cluster_has(argument, letters))
}

function is_recursive_forced_rm(segment: string): boolean {
	const args = git_argv.arguments_of(segment, RM_COMMAND)

	if (args === undefined) return false

	return (
		has_flag(args, RECURSIVE_LONG, RECURSIVE_LETTERS) && has_flag(args, FORCE_LONG, FORCE_LETTER)
	)
}

const GH_COMMAND = 'gh'
const REPO_GROUP = 'repo'
const REPO_REMOVALS: ReadonlySet<string> = new Set(['delete', 'archive'])
const REPO_EDIT = 'edit'
const VISIBILITY_FLAG = '--visibility'
const PR_GROUP = 'pr'
const PR_CLOSE = 'close'

// `gh repo delete` / `archive`, and `gh repo edit --visibility …`.
function is_destructive_repo_action(action: string, args: ReadonlyArray<string>): boolean {
	if (REPO_REMOVALS.has(action)) return true

	return action === REPO_EDIT && args.some((argument) => argument.startsWith(VISIBILITY_FLAG))
}

function is_destructive_gh_command(args: ReadonlyArray<string>): boolean {
	const [group, action = ''] = args

	if (group === PR_GROUP) return action === PR_CLOSE

	return group === REPO_GROUP && is_destructive_repo_action(action, args)
}

const DELETE_METHOD = 'DELETE'
const REPOSITORY_PATH = 'repos/'
// Removing one label from one Issue — the workflow's own `in-progress` / `needs-decision` step.
// Anchored on the whole argument, so a label path smuggled into a field value (`-f x=repos/…/labels/a`)
// does not exempt the real endpoint beside it.
const ISSUE_LABEL_PATH =
	/^['"]?\/?repos\/[^/\s'"]+\/[^/\s'"]+\/issues\/\d+\/labels\/[^/\s'"]+['"]?$/u

// Judged on the call with its wrapper cut off, since `gh_api.is_gh_api` anchors on a leading `gh` and
// would otherwise miss `env gh api -X DELETE …` that the `gh pr close` branch already sees. Every
// argument naming a repository path must be a label removal for the call to pass.
function is_destructive_api_call(args: ReadonlyArray<string>): boolean {
	const call = [GH_COMMAND, ...args].join(' ')

	if (!gh_api.is_gh_api(call) || gh_api.method_of(call) !== DELETE_METHOD) return false

	return args.some(
		(argument) => argument.includes(REPOSITORY_PATH) && !ISSUE_LABEL_PATH.test(argument),
	)
}

function is_destructive_gh(segment: string): boolean {
	const args = git_argv.arguments_of(segment, GH_COMMAND)

	if (args === undefined) return false

	return is_destructive_gh_command(args) || is_destructive_api_call(args)
}

function is_destructive_segment(segment: string): boolean {
	return is_recursive_forced_rm(segment) || is_destructive_gh(segment)
}

function is_destructive_command(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_destructive_segment(segment))
}

const DESTRUCTIVE_COMMAND_REASON =
	'⛔ destructive command: a recursive forced `rm` (`rm -rf`, `rm -fr`, `rm -r -f`, `rm --recursive ' +
	'--force`), `gh repo delete` / `archive`, `gh repo edit --visibility`, `gh pr close`, or a `gh api ' +
	'-X DELETE repos/…` call deletes or closes something that cannot be restored, which is Tier C and ' +
	'needs explicit current-turn user instruction (`prompts/collaboration-workflow/operating-rules.md`). ' +
	'The `.claude/settings.json` deny list matches prefix globs, so it misses these spellings; this row ' +
	'reads the argv instead. Remove a file or directory one path at a time without `-f`, or ask the user ' +
	'to run the command in their own terminal. `gh issue close` and removing a label from an Issue ' +
	'(`DELETE repos/<o>/<r>/issues/<N>/labels/<name>`) are not refused. **This rule fires on every ' +
	'occurrence, not once per run.**'

const ROW = {
	id: 'destructive-command',
	is_trigger: bash_triggers.on_bash_command(is_destructive_command),
	reason: DESTRUCTIVE_COMMAND_REASON,
	decide: (): boolean => true,
}

const destructive_command = { DESTRUCTIVE_COMMAND_REASON, ROW, is_destructive_command }

export { destructive_command }
