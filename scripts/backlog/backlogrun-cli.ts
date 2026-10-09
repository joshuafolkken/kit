#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_carry } from '#scripts/run/carry/run-carry'
import { backlogrun_args, type BacklogrunArguments } from './backlogrun-args'
import { backlogrun_launch, type LaunchTarget, type StartResult } from './backlogrun-launch'

// `josh backlogrun` — start a `backlogrun` from the terminal and watch it. A
// run already going is never joined by a second one: the board is shown, and any issue named is pointed
// at `run:add` rather than added behind the person's back. Otherwise the agent is started in the
// background, its output to a log file, and the board takes over the terminal at once. Closing the
// board closes only the board.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh backlogrun [#<n>...] [--only] [--max <n>] [--idle <minutes>] [--agent claude|codex]'

interface BacklogrunPorts {
	repository_directory: () => Promise<string | undefined>
	is_running: (git_directory: string) => boolean
	start: (args: BacklogrunArguments, target: LaunchTarget) => StartResult
	show_board: () => Promise<number>
	write: (line: string) => void
}

const LIVE_PORTS: BacklogrunPorts = {
	repository_directory: run_carry.repository_directory,
	is_running: backlogrun_launch.is_running,
	start: (args, target) => backlogrun_launch.start(args.invocation, args.provider, target),
	show_board: async () => await run_board_cli.run([]),
	write: (line) => process.stdout.write(`${line}\n`),
}

function running_notes(issues: ReadonlyArray<number>): Array<string> {
	const additions = issues.map((issue) => `  pnpm josh run:add ${String(issue)}`)
	const guidance = additions.length > 0 ? ['To add the named issues to it:', ...additions] : []

	return ['backlogrun: a run is already going; showing its board.', ...guidance]
}

function launched_note(result: Extract<StartResult, { kind: 'launched' }>): string {
	const { pid, session, log_path } = result.launched
	const session_part = session === undefined ? '' : `, session ${session}`

	return `backlogrun: started (pid ${String(pid)}${session_part}); log ${log_path}`
}

// The agent starts in the main checkout, the parent of the common git directory every record is keyed on.
function target_of(git_directory: string): LaunchTarget {
	return { worktree: path.dirname(git_directory), git_directory }
}

async function begin(
	args: BacklogrunArguments,
	git_directory: string,
	ports: BacklogrunPorts,
): Promise<number> {
	if (ports.is_running(git_directory)) {
		for (const note of running_notes(args.issues)) ports.write(note)

		return await ports.show_board()
	}

	const result = ports.start(args, target_of(git_directory))

	if (result.kind === 'failed') {
		ports.write(`backlogrun: could not start: ${result.note}`)

		return FAILURE_EXIT_CODE
	}

	ports.write(launched_note(result))

	return await ports.show_board()
}

async function run(
	argv: ReadonlyArray<string>,
	ports: BacklogrunPorts = LIVE_PORTS,
): Promise<number> {
	const parsed = backlogrun_args.parse(argv)

	if (parsed.kind === 'refused') {
		ports.write(USAGE)

		return FAILURE_EXIT_CODE
	}

	const git_directory = await ports.repository_directory()

	if (git_directory === undefined) {
		ports.write('backlogrun: not inside a git repository')

		return FAILURE_EXIT_CODE
	}

	return await begin(parsed.args, git_directory, ports)
}

const backlogrun_cli = { run }

// `.env` is read inside the guard, as `run:board` reads it, so the board draws in the person's
// `JOSH_SESSION_LANG` while the unit tests see no developer's `.env`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	josh_environment_file.load_environment_file()
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export type { BacklogrunPorts }
export { backlogrun_cli }
