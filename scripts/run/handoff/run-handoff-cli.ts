#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import {
	agent_provider,
	type AgentEnvironment,
	type AgentProvider,
} from '#scripts/agent/agent-provider'
import { stamp_file } from '#scripts/josh/stamp-file'
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
import { run_handoff_final } from './run-handoff-final'
import { run_handoff_launch, type BuiltArgv } from './run-handoff-launch'

// `josh run:handoff <keyword> [N|new ...] --brief-file <path>` — hand a workflow keyword typed in a
// consultation session to a child session on the kit role profile's model, on the main session's own
// provider. `kickoff` is waited for and its final message and URLs printed; `fullrun` / `halfrun` /
// `prrun` are started in the background and handed back as a log and `run:progress --once`. `backlogrun` is
// `josh backlogrun` itself, which already starts its parent on the scheduler profile.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const AGENT_FLAG = '--agent'
const LONE_FLAGS: ReadonlySet<string> = new Set(['--stop', '--restart'])
const ISSUE_TOKEN = /#(\d+)/u
const USAGE =
	'Usage: josh run:handoff kickoff|fullrun|halfrun|prrun [N|new ...] --brief-file <path> | backlogrun [...]'
// `josh backlogrun --agent` names a provider by its CLI.
const AGENT_NAMES: Readonly<Record<AgentProvider, string>> = {
	anthropic: 'claude',
	openai: 'codex',
}

interface HandoffPorts {
	environment: AgentEnvironment
	cwd: string
	now: () => number
	repository_directory: () => Promise<string | undefined>
	tree_hold: () => Promise<HoldRead>
	read_text: (target: string) => string | undefined
	launch: (request: LaunchRequest) => LaunchResult
	launch_attached: (request: LaunchRequest) => Promise<AttachedLaunchResult>
	backlogrun: (argv: ReadonlyArray<string>) => Promise<number>
	write: (line: string) => void
}

interface StartInput {
	handoff: WorkflowHandoff
	provider: AgentProvider
	brief: string
	git_directory: string
}

interface Started {
	handoff: WorkflowHandoff
	built: BuiltArgv
	request: LaunchRequest
	log: string
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

// The hold `run:entry` claims for this working tree; an unknown tree reads as unreadable, never free.
async function tree_hold(): Promise<HoldRead> {
	const directory = await run_hold.worktree_directory()

	if (directory === undefined) return { kind: 'unreadable' }

	return run_hold.read_hold(run_hold.hold_path(directory))
}

const LIVE_PORTS: HandoffPorts = {
	environment: process.env,
	cwd: process.cwd(),
	now: () => Date.now(),
	repository_directory: run_carry.repository_directory,
	tree_hold,
	read_text: (target) => stamp_file.read_stamp_text(target),
	launch: (request) => detached_launch.launch(request, note_to_stderr),
	launch_attached: async (request) =>
		await detached_launch.launch_attached(request, note_to_stderr),
	backlogrun: josh_backlogrun,
	write: (line) => process.stdout.write(`${line}\n`),
}

function refuse(note: string, ports: HandoffPorts): number {
	ports.write(`run:handoff: ${note}`)

	return FAILURE_EXIT_CODE
}

// `--stop` / `--restart` stand alone in `josh backlogrun` (`backlogrun-args.ts`), so they take no `--agent`.
function with_agent(rest: ReadonlyArray<string>, provider: AgentProvider): ReadonlyArray<string> {
	const is_kept = rest.includes(AGENT_FLAG) || rest.some((token) => LONE_FLAGS.has(token))

	return is_kept ? rest : [...rest, AGENT_FLAG, AGENT_NAMES[provider]]
}

function started_line({ handoff, built }: Started): string {
	const { provider, model, effort } = built.profile

	return `run:handoff: \`${handoff.line}\` → ${provider} ${model} / ${effort} (${built.profile.role})`
}

function result_lines(log: string): ReadonlyArray<string> {
	const message = run_handoff_final.final_message(log)

	if (message === undefined) return ['final message: none — read the log']

	const urls = run_handoff_final.github_urls(message)

	return ['final message:', message, ...urls.map((url) => `created: ${url}`)]
}

async function waited(started: Started, ports: HandoffPorts): Promise<number> {
	const result = await ports.launch_attached(started.request)

	if (result.kind === 'failed') return refuse(`could not start: ${result.note}`, ports)

	const lines = result_lines(ports.read_text(started.log) ?? '')

	for (const line of lines) ports.write(line)

	ports.write(`exit: ${String(result.exit_code)}`)

	return result.exit_code === SUCCESS_EXIT_CODE ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

// The issue the child's `run:entry` claims under: the line's first `#N`, else an unnumbered run.
function claimant_of(line: string): string {
	const issue = ISSUE_TOKEN.exec(line)?.[1]

	return issue ?? run_hold.UNNUMBERED_ISSUE
}

// The detached child's `run:entry` claims this tree and stops on `busy` where only its log would say so,
// so the claim it would make is asked before the child starts, where the session still reads the answer.
// A hand-off still starting has not claimed yet and reads free here; `run:entry` stays the guard.
async function hold_note(started: Started, ports: HandoffPorts): Promise<string | undefined> {
	const claimant = claimant_of(started.handoff.line)

	return await run_hold_block.blocking_message(await ports.tree_hold(), claimant)
}

function detached(started: Started, ports: HandoffPorts): number {
	const result = ports.launch(started.request)

	if (result.kind === 'failed') return refuse(`could not start: ${result.note}`, ports)

	ports.write(`started (pid ${String(result.pid)}); check it with: pnpm josh run:progress --once`)

	return SUCCESS_EXIT_CODE
}

async function launched(started: Started, ports: HandoffPorts): Promise<number> {
	const is_waited = run_handoff_launch.is_waited(started.handoff.keyword)
	const note = is_waited ? undefined : await hold_note(started, ports)

	if (note !== undefined) return refuse(note, ports)

	ports.write(started_line(started))
	ports.write(`log: ${started.log}`)

	return is_waited ? await waited(started, ports) : detached(started, ports)
}

function started_of(input: StartInput, ports: HandoffPorts): StartResult {
	const { handoff, provider, brief, git_directory } = input
	const prompt = run_handoff_launch.prompt_of(handoff, brief)
	const role = run_handoff_launch.role_of(handoff.keyword)
	const child = { prompt, role, provider, cwd: ports.cwd }
	const built = run_handoff_launch.argv_of(child, ports.environment)

	if (built.kind === 'rejected') return { kind: 'refused', note: `could not start: ${built.note}` }

	const log = run_handoff_launch.log_path(git_directory, handoff.keyword, ports.now())
	const request = run_handoff_launch.request_of(built, ports.cwd, log)

	return { kind: 'started', started: { handoff, built, request, log } }
}

async function handed(
	handoff: WorkflowHandoff,
	provider: AgentProvider,
	ports: HandoffPorts,
): Promise<number> {
	const brief = ports.read_text(handoff.brief_file)

	if (brief === undefined) return refuse(`could not read ${handoff.brief_file}`, ports)

	const git_directory = await ports.repository_directory()

	if (git_directory === undefined) return refuse('not inside a git repository', ports)

	const result = started_of({ handoff, provider, brief, git_directory }, ports)

	return result.kind === 'refused'
		? refuse(result.note, ports)
		: await launched(result.started, ports)
}

async function run(argv: ReadonlyArray<string>, ports: HandoffPorts = LIVE_PORTS): Promise<number> {
	const parsed = run_handoff_args.parse(argv)

	if (parsed.kind === 'refused') return refuse(`${parsed.note}\n${USAGE}`, ports)

	const selected = agent_provider.resolve_provider(ports.environment)

	if (selected.kind === 'rejected') return refuse(selected.note, ports)

	if (parsed.kind === 'backlogrun') {
		return await ports.backlogrun(with_agent(parsed.rest, selected.provider))
	}

	return await handed(parsed, selected.provider, ports)
}

const run_handoff_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGV_OFFSET))
}

export type { HandoffPorts }
export { run_handoff_cli }
