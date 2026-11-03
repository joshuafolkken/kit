import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { edit_tool } from './edit-tool'
import { git_argv, type ProgramCall } from './git-argv'
import { nested_commands } from './nested-commands'
import { shell_redirects } from './shell-redirects'

// The trigger and the delivered text behind the `workflow-edit` row of `permission-guards.ts`: a
// dispatched lane child never changes `.github/workflows/**` (joshuafolkken/kit#6050). A
// `pull_request` run executes the workflows on the PR's own branch, so a lane child steered by an
// untrusted input could rewrite `claude-review.yml` to always pass and slip past the CI review.
//
// It reads the call, not a glob: an `Edit` / `Write` by its `file_path`, and every command a `Bash`
// call runs (`bash -c`, `$()` and heredoc lines included, `nested-commands.ts`) by the files it
// writes — a `>` redirect, `tee`, the destination of `cp` / `install` / `ln`, any path of `mv` / `rm`
// / `touch` / `truncate`, an in-place `sed` / `perl`, and `git checkout` / `restore` / `rm` / `mv`.
// A read (`Read`, `cat`, `grep`, a `<` redirect) passes. A session that is not a lane child is left
// alone: an Issue that changes a workflow is implemented in an interactive session.

const WORKFLOW_PATH = /(?:^|\/)\.github\/workflows(?:\/|$)/u
const QUOTES = /["']/gu
const LAST = -1
// Programs where any path argument is changed.
const PATH_WRITERS: ReadonlySet<string> = new Set(['mv', 'rm', 'tee', 'touch', 'truncate'])
// Programs whose last argument is the file written.
const COPIERS: ReadonlySet<string> = new Set(['cp', 'install', 'ln', 'rsync'])
// Programs that write their file arguments only with an in-place flag (`-i`, `-i.bak`, `-pi`).
const IN_PLACE_EDITORS: ReadonlySet<string> = new Set(['perl', 'sed'])
const IN_PLACE_FLAG = /^(?:-[A-Za-z]*i|--in-place)/u
const GIT_WRITERS: ReadonlySet<string> = new Set(['checkout', 'mv', 'restore', 'rm'])

function is_workflow_path(word: string): boolean {
	return WORKFLOW_PATH.test(word.replaceAll(QUOTES, ''))
}

function names_workflow(words: ReadonlyArray<string>): boolean {
	return words.some((word) => is_workflow_path(word))
}

function written_args(call: ProgramCall): ReadonlyArray<string> {
	if (PATH_WRITERS.has(call.name)) return call.args
	if (COPIERS.has(call.name)) return call.args.slice(LAST)
	if (!IN_PLACE_EDITORS.has(call.name)) return []

	return call.args.some((word) => IN_PLACE_FLAG.test(word)) ? call.args : []
}

function is_git_write(segment: string): boolean {
	const call = git_argv.parse(segment)

	if (call?.subcommand === undefined || !GIT_WRITERS.has(call.subcommand)) return false

	return names_workflow(call.args)
}

function is_workflow_write_segment(segment: string): boolean {
	const call = git_argv.program_of(segment)

	if (names_workflow(shell_redirects.written_of(segment, call?.name))) return true
	if (call === undefined) return false

	return names_workflow(written_args(call)) || is_git_write(segment)
}

function is_workflow_shell_write(command: string): boolean {
	return nested_commands.commands_of(command).some((segment) => is_workflow_write_segment(segment))
}

function is_workflow_file_edit(call: GuardedCall): boolean {
	if (!edit_tool.is_edit_tool(call.name) || !json_value.is_record(call.input)) return false

	return is_workflow_path(edit_tool.string_field(call.input, 'file_path'))
}

function is_workflow_edit_call(
	call: GuardedCall,
	is_lane_child: boolean = lane_child_marker.is_child_of(process.cwd()),
): boolean {
	if (!is_lane_child) return false

	return is_workflow_file_edit(call) || bash_triggers.on_bash_command(is_workflow_shell_write)(call)
}

const WORKFLOW_EDIT_REASON =
	'⛔ lane child changing `.github/workflows/**`: a `pull_request` run executes the branch’s own ' +
	'workflows, so a lane never edits them. An Issue that changes a workflow is not implemented in a ' +
	'lane — park it for an interactive session. Reading a workflow passes. It fires on every occurrence.'

const ROW = {
	id: 'workflow-edit',
	is_trigger: is_workflow_edit_call,
	reason: WORKFLOW_EDIT_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Lane child changing a workflow',
		topic: '`SECURITY.md`',
		fires:
			'a dispatched lane child changing `.github/workflows/**` — an `Edit` / `Write` of it, or a `Bash` write to it (a `>` redirect, `tee`, `cp` / `install` / `ln` to it, `mv` / `rm` / `touch` / `truncate`, an in-place `sed` / `perl`, `git checkout` / `restore` / `rm` / `mv`), inside `bash -c`, `$()` or a heredoc too. Every occurrence',
		quiet: 'not a lane child, or a read (`Read`, `cat`, `grep`, a `<` redirect)',
	},
}

const workflow_edit = { ROW, WORKFLOW_EDIT_REASON, is_workflow_edit_call }

export { workflow_edit }
