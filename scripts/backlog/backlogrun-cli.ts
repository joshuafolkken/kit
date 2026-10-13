#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from '#scripts/josh/josh-environment-file'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_carry } from '#scripts/run/carry/run-carry'
import { backlogrun_args, type BacklogrunArguments } from './backlogrun-args'
import { backlogrun_launch, type LaunchTarget, type StartResult } from './backlogrun-launch'
import { backlogrun_replace, type ReplaceVerdict } from './backlogrun-replace'
import { backlogrun_stop, type StopReport } from './backlogrun-stop'

// `josh backlogrun` — start a `backlogrun` from the terminal and watch it, or stop it with `--stop`. A
// run already going is never joined by a second one: the board is shown, and any issue named is pointed
// at `run:add` rather than added behind the person's back. Otherwise the agent is started in the
// background, its output to a log file, and the board takes over the terminal at once. Closing the
// board closes only the board.
//
// **An idle run gives way to a different invocation.** A run watching with no child at work in a lane
// is stopped as `--stop` stops it and the typed one is started in its place (`backlogrun-replace.ts`);
// a run that is kept says why in one line above the board. The same invocation only shows the board,
// so looking at a run never rebuilds it.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh backlogrun [<n>...] [--only] [--max <n>] [--idle <minutes>] [--agent claude|codex] | --stop'

interface BacklogrunPorts {
	repository_directory: () => Promise<string | undefined>
	is_running: (git_directory: string) => boolean
	replacement: (invocation: string, git_directory: string) => Promise<ReplaceVerdict>
	start: (args: BacklogrunArguments, target: LaunchTarget) => StartResult
	stop: (git_directory: string) => Promise<StopReport>
	show_board: () => Promise<number>
	write: (line: string) => void
}

const LIVE_PORTS: BacklogrunPorts = {
	repository_directory: run_carry.repository_directory,
	is_running: backlogrun_launch.is_running,
	replacement: async (invocation, git_directory) =>
		await backlogrun_replace.decide(invocation, git_directory),
	start: (args, target) => backlogrun_launch.start(args.invocation, args.provider, target),
	stop: async (git_directory) => await backlogrun_stop.stop(git_directory),
	show_board: async () => await run_board_cli.run([]),
	write: (line) => process.stdout.write(`${line}\n`),
}

function running_notes(issues: ReadonlyArray<number>): Array<string> {
	const additions = issues.map((issue) => `  pnpm josh run:add ${String(issue)}`)
	const guidance = additions.length > 0 ? ['To add the named issues to it:', ...additions] : []

	return ['backlogrun: a run is already going; showing its board.', ...guidance]
}

// Why a different invocation did not replace the run, ahead of the board. The same invocation is the
// board reopened, and adds nothing.
function kept_notes(verdict: ReplaceVerdict): Array<string> {
	return verdict.kind === 'keep' ? [`backlogrun: not replacing the run — ${verdict.reason}`] : []
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

async function launch(
	args: BacklogrunArguments,
	git_directory: string,
	ports: BacklogrunPorts,
): Promise<number> {
	const result = ports.start(args, target_of(git_directory))

	if (result.kind === 'failed') {
		ports.write(`backlogrun: could not start: ${result.note}`)

		return FAILURE_EXIT_CODE
	}

	ports.write(launched_note(result))

	return await ports.show_board()
}

// The idle run is stopped as `--stop` stops it, and a run left with an owner this command may not
// signal is not replaced: nothing is started beside it.
async function replace(
	args: BacklogrunArguments,
	git_directory: string,
	ports: BacklogrunPorts,
): Promise<number> {
	ports.write(`backlogrun: replacing the idle run with \`${args.invocation}\``)

	const report = await ports.stop(git_directory)

	for (const line of backlogrun_stop.lines_of(report)) ports.write(line)

	if (!backlogrun_stop.is_stopped(report)) return FAILURE_EXIT_CODE

	return await launch(args, git_directory, ports)
}

async function begin(
	args: BacklogrunArguments,
	git_directory: string,
	ports: BacklogrunPorts,
): Promise<number> {
	if (!ports.is_running(git_directory)) return await launch(args, git_directory, ports)

	const verdict = await ports.replacement(args.invocation, git_directory)

	if (verdict.kind === 'replace') return await replace(args, git_directory, ports)

	for (const note of [...kept_notes(verdict), ...running_notes(args.issues)]) ports.write(note)

	return await ports.show_board()
}

// Stopping starts nothing and draws no board: the lines say what was stopped, and a run left with an
// owner this command may not signal is a failure the exit code carries.
async function stop(git_directory: string, ports: BacklogrunPorts): Promise<number> {
	const report = await ports.stop(git_directory)

	for (const line of backlogrun_stop.lines_of(report)) ports.write(line)

	return backlogrun_stop.is_stopped(report) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

function refuse(line: string, ports: BacklogrunPorts): number {
	ports.write(line)

	return FAILURE_EXIT_CODE
}

async function run(
	argv: ReadonlyArray<string>,
	ports: BacklogrunPorts = LIVE_PORTS,
): Promise<number> {
	const parsed = backlogrun_args.parse(argv)

	if (parsed.kind === 'refused') return refuse(USAGE, ports)

	const git_directory = await ports.repository_directory()

	if (git_directory === undefined) return refuse('backlogrun: not inside a git repository', ports)
	if (parsed.kind === 'stop') return await stop(git_directory, ports)

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
