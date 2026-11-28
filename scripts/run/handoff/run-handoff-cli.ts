#!/usr/bin/env tsx
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	agent_provider,
	type AgentEnvironment,
	type AgentProvider,
} from '#scripts/agent/agent-provider'
import { git_command } from '#scripts/git/git-command'
import type { AdoptBranch } from '#scripts/issue/issue-body-adopt-branch'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_carry } from '#scripts/run/carry/run-carry'
import {
	detached_launch,
	type AttachedLaunchResult,
	type LaunchRequest,
	type LaunchResult,
} from '#scripts/run/detached-launch'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_hold_block } from '#scripts/run/hold/run-hold-block'
import { execa } from 'execa'
import { run_handoff_args, type WorkflowHandoff } from './run-handoff-args'
import { run_handoff_brief, type LedgerPorts } from './run-handoff-brief'
import { run_handoff_final } from './run-handoff-final'
import { run_handoff_launch, type BuiltArgv, type HandoffChild } from './run-handoff-launch'
import { run_handoff_release } from './run-handoff-release'
import { run_handoff_tree } from './run-handoff-tree'
import { run_handoff_wip } from './run-handoff-wip'

// `josh run:handoff <keyword> [N|new ...] --brief-file <path>` — hand a workflow keyword typed in a
// consultation session to a child session on the kit role profile's model, on the main session's own
// provider. `kickoff` is waited for and its final message and URLs printed; `fullrun` / `halfrun` /
// `prrun` are started in the background and handed back as a log and `run:progress --once`. `backlogrun` is
// `josh backlogrun` itself, which already starts its parent on the scheduler profile.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
// The line `kickoff new …` — `kickoff #N` plans an existing Issue instead.
const KICKOFF_NEW_LINE = /^kickoff\s+new(?:\s|$)/u
const USAGE =
	'Usage: josh run:handoff kickoff|fullrun|halfrun|prrun [N|new ...] --brief-file <path> [--wip <name>] [--again] | brief-path | retrospective | backlogrun [...]'

interface HandoffPorts extends LedgerPorts {
	environment: AgentEnvironment
	cwd: string
	now: () => number
	repository_directory: () => Promise<string | undefined>
	// The hold on the work tree at the directory, as `run:entry` would read it there.
	tree_hold: (directory: string) => Promise<HoldRead>
	branch_at: (directory: string) => Promise<string>
	lane_directory: (issue: string) => Promise<string | undefined>
	read_text: (target: string) => string | undefined
	launch: (request: LaunchRequest) => LaunchResult
	launch_attached: (
		request: LaunchRequest,
		on_spawn: (pid: number) => void,
	) => Promise<AttachedLaunchResult>
	make_directory: (target: string) => void
	// A fresh brief path for this session (`run-handoff-brief.ts`).
	brief_path: () => string
	backlogrun: (argv: ReadonlyArray<string>) => Promise<number>
	// Whether the carry record under this git directory marks the retrospective as run.
	is_retrospective_done: (git_directory: string) => boolean
	// Lifts `handoff:implementing` from a hand-off child's filing a failed hand-off leaves behind.
	release_filing: (
		handoff: WorkflowHandoff,
		environment: AgentEnvironment,
	) => Promise<string | undefined>
	write: (line: string) => void
	// The commit `ref` names, or `undefined` when it names none.
	resolve_commit: (reference: string) => Promise<string | undefined>
	// `--wip` on `#N`: writes the adopt row into #N's body; the problem when it could not.
	write_adopt_row: (issue: string, row: AdoptBranch) => Promise<string | undefined>
}

interface StartInput {
	handoff: WorkflowHandoff
	provider: AgentProvider
	brief: string
	// The brief's digest the ledger records once the child starts; `undefined` for a generated brief.
	digest: string | undefined
	git_directory: string
	// The child's extra environment: `--wip`'s resolved branch for its `issue:file` to write.
	wip_environment: Readonly<Record<string, string>>
}

interface Started {
	handoff: WorkflowHandoff
	built: BuiltArgv
	request: LaunchRequest
	log: string
	// The child's own scratch directory, relative to its work tree, which its prompt names.
	scratch: string
	digest: string | undefined
	git_directory: string
	// The work tree the child runs in (`run-handoff-tree.ts`).
	directory: string
}

type StartResult = { kind: 'started'; started: Started } | { kind: 'refused'; note: string }

function note_to_stderr(note: string): void {
	console.error(`run:handoff: ${note}`)
}

// `josh backlogrun` runs as its own command, so it loads its `.env` and owns its output; its CLI module
// is an entry, never imported (`scripts/build/main-guard-boundary.test.ts`).
async function josh_backlogrun(argv: ReadonlyArray<string>): Promise<number> {
	const result = await execa('pnpm', ['josh', 'backlogrun', ...argv], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAILURE_EXIT_CODE
}

const LIVE_PORTS: HandoffPorts = {
	environment: process.env,
	cwd: process.cwd(),
	now: () => Date.now(),
	repository_directory: run_carry.repository_directory,
	tree_hold: run_handoff_tree.tree_hold,
	branch_at: git_command.branch_at,
	lane_directory: run_handoff_tree.lane_directory,
	read_text: (target) => stamp_file.read_stamp_text(target),
	launch: (request) => detached_launch.launch(request, note_to_stderr),
	launch_attached: async (request, on_spawn) =>
		await detached_launch.launch_attached(request, note_to_stderr, on_spawn),
	make_directory: (target) => {
		mkdirSync(target, { recursive: true })
	},
	brief_path: () => run_handoff_brief.brief_path(process.cwd()),
	read_ledger: (target) => stamp_file.read_stamp_text(target),
	append_ledger: run_handoff_brief.append_ledger,
	backlogrun: josh_backlogrun,
	is_retrospective_done: (git_directory) =>
		run_carry.retrospective_done_of(run_carry.read_carry(run_carry.carry_path(git_directory))),
	release_filing: run_handoff_release.release,
	write: (line) => process.stdout.write(`${line}\n`),
	resolve_commit: run_handoff_wip.resolve_commit,
	write_adopt_row: run_handoff_wip.write_row,
}

function refuse(note: string, ports: HandoffPorts): number {
	ports.write(`run:handoff: ${note}`)

	return FAILURE_EXIT_CODE
}

function started_line({ handoff, built }: Started): string {
	const { provider, model, effort } = built.profile

	return `run:handoff: \`${handoff.line}\` → ${provider} ${model} / ${effort} (${built.profile.role})`
}

function result_lines(message: string | undefined): ReadonlyArray<string> {
	if (message === undefined) return ['final message: none — read the log']

	const urls = run_handoff_final.github_urls(message)

	return ['final message:', message, ...urls.map((url) => `created: ${url}`)]
}

// The retrospective unit succeeded only if its `run:carry --retrospective` mark is on the record; its own
// exit code cannot say so, since a session that never wrote the mark still ends cleanly.
function closed_retrospective(started: Started, ports: HandoffPorts): number {
	if (ports.is_retrospective_done(started.git_directory)) return SUCCESS_EXIT_CODE

	return refuse('the retrospective unit ended without run:carry --retrospective', ports)
}

// A `kickoff new` child can end cleanly without filing — a cut-off `issue:file` — so its success is the
// created Issue's URL in its final message, which its prompt asks for (`run-handoff-launch.ts`).
function filed_kickoff(started: Started, message: string | undefined, ports: HandoffPorts): number {
	if (run_handoff_final.names_issue(message)) return SUCCESS_EXIT_CODE

	return refuse(
		[
			'kickoff new ended without a created Issue URL — nothing is confirmed filed;',
			`read the log: ${started.log}`,
			'A cut-off issue:file may still have created it: before filing again, search for it with',
			'`gh issue list --search "<title>" --state all`.',
		].join('\n'),
		ports,
	)
}

function waited_exit(
	started: Started,
	exit_code: number | null,
	message: string | undefined,
	ports: HandoffPorts,
): number {
	if (started.handoff.keyword === run_handoff_args.RETROSPECTIVE_KEYWORD) {
		return closed_retrospective(started, ports)
	}

	if (exit_code !== SUCCESS_EXIT_CODE) return FAILURE_EXIT_CODE

	return KICKOFF_NEW_LINE.test(started.handoff.line)
		? filed_kickoff(started, message, ports)
		: SUCCESS_EXIT_CODE
}

// The brief goes on the ledger once its child starts, so a start that failed can be handed off again.
function recorded(started: Started, ports: HandoffPorts): void {
	run_handoff_brief.record(started, ports.now(), ports.append_ledger)
}

async function waited(started: Started, ports: HandoffPorts): Promise<number> {
	const result = await ports.launch_attached(started.request, () => {
		recorded(started, ports)
	})

	if (result.kind === 'failed') return refuse(`could not start: ${result.note}`, ports)

	const message = run_handoff_final.final_message(ports.read_text(started.log) ?? '')

	for (const line of result_lines(message)) ports.write(line)

	ports.write(`exit: ${String(result.exit_code)}`)

	return waited_exit(started, result.exit_code, message, ports)
}

// The issue the child's `run:entry` claims under: the line's first `#N`, else an unnumbered run.
function claimant_of(line: string): string {
	return run_handoff_tree.issue_of(line) ?? run_hold.UNNUMBERED_ISSUE
}

// The detached child's `run:entry` claims this tree and stops on `busy` where only its log would say so,
// so the claim it would make is asked before the child starts, where the session still reads the answer.
// A hand-off still starting has not claimed yet and reads free here; `run:entry` stays the guard.
async function hold_note(started: Started, ports: HandoffPorts): Promise<string | undefined> {
	const claimant = claimant_of(started.handoff.line)

	return await run_hold_block.blocking_message(await ports.tree_hold(started.directory), claimant)
}

function detached(started: Started, ports: HandoffPorts): number {
	const result = ports.launch(started.request)

	if (result.kind === 'failed') return refuse(`could not start: ${result.note}`, ports)

	recorded(started, ports)
	ports.write(`started (pid ${String(result.pid)}); check it with: pnpm josh run:progress --once`)

	return SUCCESS_EXIT_CODE
}

async function launched(started: Started, ports: HandoffPorts): Promise<number> {
	const is_waited = run_handoff_launch.is_waited(started.handoff.keyword)
	const note = is_waited ? undefined : await hold_note(started, ports)

	if (note !== undefined) return refuse(note, ports)

	ports.make_directory(path.join(started.directory, started.scratch))
	ports.write(started_line(started))
	ports.write(`work tree: ${started.directory}`)
	ports.write(`log: ${started.log}`)

	return is_waited ? await waited(started, ports) : detached(started, ports)
}

function child_of(input: StartInput, scratch: string, cwd: string): HandoffChild {
	const { handoff, provider, brief } = input
	const { keyword } = handoff
	const prompt = run_handoff_launch.prompt_of(handoff, brief, scratch)

	return { prompt, role: run_handoff_launch.role_of(keyword), provider, cwd, keyword }
}

// One start time names both the log and the scratch directory, so each child's pair reads together.
function started_of(input: StartInput, directory: string, ports: HandoffPorts): StartResult {
	const { handoff, git_directory, digest } = input
	const now = ports.now()
	const scratch = run_handoff_launch.scratch_directory(handoff.keyword, now)
	const built = run_handoff_launch.argv_of(child_of(input, scratch, directory), ports.environment)

	if (built.kind === 'rejected') return { kind: 'refused', note: `could not start: ${built.note}` }

	const log = run_handoff_launch.log_path(git_directory, handoff.keyword, now)
	const request = run_handoff_wip.with_environment(
		run_handoff_launch.request_of(built, directory, log, handoff.line),
		input.wip_environment,
	)
	const started = { handoff, built, request, log, scratch, digest, git_directory, directory }

	return { kind: 'started', started }
}

// The child starts in the work tree its run belongs in — a lane for a numbered run that edits.
async function tree_started(input: StartInput, ports: HandoffPorts): Promise<StartResult> {
	const tree = await run_handoff_tree.work_tree(input.handoff, ports)

	return tree.kind === 'refused' ? tree : started_of(input, tree.directory, ports)
}

// A mark already on the record would read as the unit's own close after it ends, so a retrospective
// no longer owed is refused before any unit starts.
function is_already_closed(
	handoff: WorkflowHandoff,
	git_directory: string,
	ports: HandoffPorts,
): boolean {
	if (handoff.keyword !== run_handoff_args.RETROSPECTIVE_KEYWORD) return false

	return ports.is_retrospective_done(git_directory)
}

async function from_input(input: StartInput, ports: HandoffPorts): Promise<number> {
	const result = await tree_started(input, ports)

	return result.kind === 'refused'
		? refuse(result.note, ports)
		: await launched(result.started, ports)
}

async function handed(
	handoff: WorkflowHandoff,
	provider: AgentProvider,
	ports: HandoffPorts,
): Promise<number> {
	const git_directory = await ports.repository_directory()

	if (git_directory === undefined) return refuse('not inside a git repository', ports)

	const read = run_handoff_brief.brief_of(handoff, { ...ports, git_directory })

	if (read.kind === 'problem') return refuse(read.problem, ports)

	if (is_already_closed(handoff, git_directory, ports)) {
		return refuse('the carry already marks the retrospective as run; nothing is owed', ports)
	}

	const wip = await run_handoff_wip.environment_of(handoff, {
		resolve: ports.resolve_commit,
		write_row: ports.write_adopt_row,
	})

	if ('problem' in wip) return refuse(wip.problem, ports)

	const { text: brief, digest } = read

	return await from_input(
		{ handoff, provider, brief, digest, git_directory, wip_environment: wip.environment },
		ports,
	)
}

// A failed hand-off ends a `new` child, so its filing is released to the lane `backlogrun` opens.
async function released(
	handoff: WorkflowHandoff,
	exit_code: number,
	ports: HandoffPorts,
): Promise<number> {
	if (exit_code === SUCCESS_EXIT_CODE) return exit_code

	const line = await ports.release_filing(handoff, ports.environment)

	if (line !== undefined) ports.write(`run:handoff: ${line}`)

	return exit_code
}

async function dispatch(argv: ReadonlyArray<string>, ports: HandoffPorts): Promise<number> {
	const parsed = run_handoff_args.parse(argv)

	if (parsed.kind === 'refused') return refuse(`${parsed.note}\n${USAGE}`, ports)

	if (parsed.kind === 'brief-path') {
		ports.write(ports.brief_path())

		return SUCCESS_EXIT_CODE
	}

	const selected = agent_provider.resolve_provider(ports.environment)

	if (selected.kind === 'rejected') return refuse(selected.note, ports)

	if (parsed.kind === 'backlogrun') {
		return await ports.backlogrun(run_handoff_args.with_agent(parsed.rest, selected.provider))
	}

	return await released(parsed, await handed(parsed, selected.provider, ports), ports)
}

async function run(argv: ReadonlyArray<string>, ports: HandoffPorts = LIVE_PORTS): Promise<number> {
	if (lane_child_marker.is_child_of(ports.cwd, ports.environment)) {
		return refuse(
			'lane children cannot use run:handoff; continue the workflow in this session',
			ports,
		)
	}

	return await dispatch(argv, ports)
}

const run_handoff_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export type { HandoffPorts }
export { run_handoff_cli }
