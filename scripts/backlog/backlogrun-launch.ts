import { randomUUID } from 'node:crypto'
import { agent_argv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import {
	agent_role_profile,
	type AgentEnvironment,
	type AgentProvider,
} from '#scripts/agent/agent-role-profile'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { detached_launch, type LaunchResult } from '#scripts/run/detached-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_headless } from '#scripts/run/run-headless'
import { z } from 'zod'

// How `josh backlogrun` starts a `backlogrun` parent in the background, and how
// it tells one is already running so a second is never started beside it.
//
// **Running is two records, not one.** A parent claims the carry record a little after it starts, so
// between the launch and the claim only the launch record this file writes says a run is coming; once
// the claim is made the carry record's owner is what answers. Either one live is a run.
//
// **The agent is the person's choice, not the shell's.** The provider is resolved from an environment
// with every agent-session key cleared and the choice handed in, so a command typed inside a Claude Code
// session can still start a Codex parent. The same choice is handed to the parent as
// `JOSH_AGENT_PROVIDER`, the key a detached child with no session of its own resolves from.

const LAUNCH_PREFIX = 'josh-backlogrun-launch-'
const LOG_PREFIX = 'josh-backlogrun-log-'
const LOG_SUFFIX = '.log'

const launch_schema = z.object({
	pid: z.number(),
	start: z.string().optional(),
	session: z.string().optional(),
	// What the parent was started to run and when, so `run:board` has a run to draw and a clock to count
	// before the parent claims the carry record. Absent on a record an earlier version wrote.
	invocation: z.string().optional(),
	started_at: z.string().optional(),
})

type LaunchRecord = z.infer<typeof launch_schema>

// A launched run the parent has not claimed yet, as far as its record says.
interface PendingLaunch {
	invocation: string
	started_at: string
}

interface LaunchTarget {
	// The checkout the parent runs in, and its common git directory the records are keyed on.
	worktree: string
	git_directory: string
}

interface Launched {
	pid: number
	session: string | undefined
	log_path: string
}

type StartResult = { kind: 'launched'; launched: Launched } | { kind: 'failed'; note: string }

function launch_path(git_directory: string): string {
	return stamp_file.stamp_path(LAUNCH_PREFIX, git_directory)
}

function log_path(git_directory: string): string {
	return stamp_file.stamp_path(LOG_PREFIX, git_directory, LOG_SUFFIX)
}

function read_launch(target: string): LaunchRecord | undefined {
	return json_value.parse_with(stamp_file.read_stamp_text(target) ?? '', launch_schema)
}

// The launched parent is still the process it was: a pid reused by another process is not a run.
function is_launch_live(record: LaunchRecord | undefined): boolean {
	if (record === undefined) return false

	return process_identity.is_same_process(record.pid, record.start) !== false
}

function is_carry_live(read: CarryRead): boolean {
	return read.kind === 'carried' && run_carry.is_owner_live(read.carry)
}

function is_running(git_directory: string): boolean {
	if (is_carry_live(run_carry.read_carry(run_carry.carry_path(git_directory)))) return true

	return is_launch_live(read_launch(launch_path(git_directory)))
}

// The environment the chosen provider resolves from, whatever session this command was typed in.
function chosen_environment(
	provider: AgentProvider,
	environment: AgentEnvironment = process.env,
): AgentEnvironment {
	return {
		...environment,
		...agent_session_environment.removed_environment(environment),
		[agent_role_profile.CODEX_SESSION_KEY]: undefined,
		[agent_role_profile.HANDED_PROVIDER_KEY]: provider,
	}
}

// Only a Claude parent takes a forced session id, so only it can be resumed by one later.
function session_for(provider: AgentProvider): string | undefined {
	return provider === 'anthropic' ? randomUUID() : undefined
}

function argv_of(
	invocation: string,
	provider: AgentProvider,
	worktree: string,
	session: string | undefined,
): AgentArgvResult {
	const environment = chosen_environment(provider)
	const resolved = agent_role_profile.resolve(agent_role_profile.SCHEDULER, environment)

	if (resolved.kind === 'rejected') return resolved

	return agent_argv.with_profile_in(invocation, resolved.profile, worktree, session)
}

function note_to_stderr(note: string): void {
	console.error(`backlogrun: ${note}`)
}

// **The record and the run's first stage carry one moment**, so the `starting session` event is never
// dated before the start the board measures from.
function record_launch(
	git_directory: string,
	launch: Pick<LaunchRecord, 'pid' | 'session' | 'invocation'>,
): void {
	const now = new Date()
	const identity = process_identity.read_start(launch.pid)
	const record: LaunchRecord = { ...launch, start: identity, started_at: now.toISOString() }

	stamp_file.replace_stamp(launch_path(git_directory), record)
	run_event_setup.emit_in(git_directory, run_event_setup.STAGE.STARTING, now)
}

// The live launch record here, `undefined` once the parent it names is gone.
function live_launch(git_directory: string): LaunchRecord | undefined {
	const record = read_launch(launch_path(git_directory))

	return is_launch_live(record) ? record : undefined
}

// The launch `run:board` draws while no carry record stands: one whose record says what it runs and
// since when.
function pending_launch(git_directory: string): PendingLaunch | undefined {
	const { invocation, started_at } = live_launch(git_directory) ?? {}

	if (invocation === undefined || started_at === undefined) return undefined

	return { invocation, started_at }
}

// When the launch that started `owner_pid` began, for `run:carry --begin` to start the run's clock
// from: **only the parent this launch started inherits it**, so a run typed inside a session — which has
// no launch record, or another parent's — still starts at its own `--begin`.
function started_for(git_directory: string, owner_pid: number | undefined): Date | undefined {
	const record = live_launch(git_directory)

	if (record?.started_at === undefined || record.pid !== owner_pid) return undefined

	const started_ms = Date.parse(record.started_at)

	return Number.isNaN(started_ms) ? undefined : new Date(started_ms)
}

function signal_parent(pid: number): void {
	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		note_to_stderr(`process ${String(pid)} could not be signalled; its launch record is removed.`)
	}
}

// The pid `stop_parent` would stop, read without stopping it.
function running_parent(git_directory: string): number | undefined {
	return live_launch(git_directory)?.pid
}

// Stops the parent this launcher started and forgets its launch — the pid stopped, `undefined` where
// no launched parent was live. **Only the process the record names, and only while it is still that
// process**: a session a person typed `backlogrun` into has no launch record and is never signalled.
function stop_parent(git_directory: string): number | undefined {
	const record = live_launch(git_directory)

	stamp_file.remove_stamp(launch_path(git_directory))

	if (record === undefined) return undefined

	signal_parent(record.pid)

	return record.pid
}

// The headless mark holds the parent's turn open while its lanes run, as `run:wake`'s does. The launch
// strips only Claude's session keys, so a Codex session this was typed in is cleared here too — inherited,
// it would make the parent's own `josh` commands resolve the wrong provider.
function spawn_parent(
	argv: Extract<AgentArgvResult, { kind: 'argv' }>,
	provider: AgentProvider,
	target: LaunchTarget,
): LaunchResult {
	const environment = {
		...run_headless.environment(),
		[agent_role_profile.CODEX_SESSION_KEY]: undefined,
		[agent_role_profile.HANDED_PROVIDER_KEY]: provider,
	}
	const log = log_path(target.git_directory)

	return detached_launch.launch(
		{
			argv: argv.argv,
			cwd: target.worktree,
			env: environment,
			log_path: log,
			profile: argv.profile,
		},
		note_to_stderr,
	)
}

function start(invocation: string, provider: AgentProvider, target: LaunchTarget): StartResult {
	const session = session_for(provider)
	const built = argv_of(invocation, provider, target.worktree, session)

	if (built.kind === 'rejected') return { kind: 'failed', note: built.note }

	const result = spawn_parent(built, provider, target)

	if (result.kind === 'failed') return result

	record_launch(target.git_directory, { pid: result.pid, session, invocation })

	const launched = { pid: result.pid, session, log_path: log_path(target.git_directory) }

	return { kind: 'launched', launched }
}

const backlogrun_launch = {
	argv_of,
	chosen_environment,
	is_running,
	pending_launch,
	running_parent,
	start,
	started_for,
	stop_parent,
}

export type { Launched, LaunchTarget, PendingLaunch, StartResult }
export { backlogrun_launch }
