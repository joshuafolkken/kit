import { command_memory } from '#scripts/gate/command-memory'
import { bash_triggers } from './bash-triggers'
import type { ProgramCall } from './git-argv'
import { shell_segments } from './shell-segments'

// The `direct-git-status` row of `delivered-rules.ts` (joshuafolkken/kit#7144). `pnpm josh tree:status`
// prints `git status --porcelain --branch` with the stash list and the run's hold beside it, so a
// hand-typed `git status` in the forms it covers reads less than the command that exists for it.
//
// **Only the forms `tree:status` covers**: no flag, or only `-s` / `--short` / `-b` / `--branch` /
// `--porcelain`. A global flag before the subcommand (`git -C <dir> status`, `--git-dir`) reads
// another tree, and a pathspec or any other flag (`--ignored`, `-uno`) narrows the listing in a way
// `tree:status` cannot, so both stay silent. The line is read program by program
// (`command_memory.tool_calls_of`), so a quoted mention is not a call.
//
// **Once per run**: the read is harmless, so the refusal points the way once and the reissue passes.

const GIT_PROGRAM = 'git'
const STATUS_SUBCOMMAND = 'status'
const COVERED_FLAGS: ReadonlySet<string> = new Set([
	'-s',
	'--short',
	'-b',
	'--branch',
	'--porcelain',
])
const SHORT_BRANCH_CLUSTER = /^-[sb]+$/u

function is_covered_flag(argument: string): boolean {
	return COVERED_FLAGS.has(argument) || SHORT_BRANCH_CLUSTER.test(argument)
}

function is_covered_call(call: ProgramCall): boolean {
	const [subcommand, ...flags] = call.args
	const is_status = call.name === GIT_PROGRAM && subcommand === STATUS_SUBCOMMAND

	return is_status && flags.every((flag) => is_covered_flag(flag))
}

function is_covered_status(command: string): boolean {
	return command_memory.tool_calls_of(command).some((call) => is_covered_call(call))
}

const TREE_STATUS: ReadonlySet<string> = new Set(['tree:status'])

function is_tree_status(command: string): boolean {
	return shell_segments
		.segments_of(command)
		.some((segment) => shell_segments.is_josh_command(segment, TREE_STATUS))
}

function is_any_status(command: string): boolean {
	return is_covered_status(command) || is_tree_status(command)
}

const DIRECT_GIT_STATUS_REASON =
	'⛔ direct git status: pnpm josh tree:status\n' +
	'Run that in place of this `git status` — it prints `git status --porcelain --branch` with the ' +
	'stash list and the run hold beside it (`docs/josh-commands-backlog.md` → "`josh tree:status`"). ' +
	'A `git -C <dir> status` or one narrowed by a pathspec or another flag passes. Once per run: the ' +
	'reissue passes.'

const ROW = {
	id: 'direct-git-status',
	is_trigger: bash_triggers.on_bash_command(is_covered_status),
	reason: DIRECT_GIT_STATUS_REASON,
	keeps: bash_triggers.on_bash_command(is_tree_status),
	reaches: bash_triggers.on_bash_command(is_any_status),
	about: {
		title: 'Direct git status',
		topic: '`docs/josh-commands-backlog.md` → "`josh tree:status`"',
		fires:
			'a `git status` with no flag or only `-s` / `--short` / `-b` / `--branch` / `--porcelain` (bare, wrapped or inside `sh -c`); it points at `pnpm josh tree:status`. Once per run',
		quiet:
			'`pnpm josh tree:status`, a global flag before the subcommand (`git -C <dir> status`), or a pathspec or any other flag',
	},
}

const direct_git_status = { DIRECT_GIT_STATUS_REASON, ROW, is_covered_status }

export { direct_git_status }
