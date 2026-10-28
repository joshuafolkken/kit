import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND, PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import {
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	run_liveness,
	type ProcessTrace,
} from '#scripts/run/run-liveness'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_handoff } from './lane-handoff'
import { process_tools } from './process-tools'

// Detached lane children are not harness-tracked processes, so their completion fires no
// re-invocation event in the parent's session. Without a blocking wait the parent notices only
// on the next heartbeat interval -- up to 15 minutes after the fact.
//
// **The re-confirm delay is the one value the caller must not be left to choose.** A process that
// disappears briefly and reappears (the pre-gate boundary cut, where one process exits and a
// resume process takes over in the same lane) looks exactly like a completion to a bare `pgrep`
// poll. The re-confirm window must be long enough to survive the cut's handoff time and short
// enough to not add observable delay after a genuine completion. Both constraints are measured
// rather than guessed and neither belongs in an agent prompt.

const RECONFIRM_MS = 15_000
const DEFAULT_POLL_MS = 5000
const NEVER_APPEARED_TIMEOUT_MS = 600_000
const PROCESS_FOUND = 0
const PROCESS_NOT_FOUND = 1
const PGREP_COMMAND = 'pgrep'

// `is_settled` is read once, when the wait starts: a child that ended between two `lane:await` calls
// never appears in the second one, and only its settled issue tells it apart from one not yet
// launched.
//
// `alive_since` is when this run of the child was first seen alive: a ship it launched is no older, so
// a ship record launched earlier is a past dispatch's (joshuafolkken/kit#4395). A child already alive
// when the watch began gets the first poll's time, so a ship it launched before that is not read as
// its own and its disappearance waits out the re-confirm window.
interface AwaitState {
	appeared: boolean
	alive_since?: number | undefined
	disappeared_at: number | undefined
	first_polled_at: number | undefined
	is_settled?: boolean
}

interface AwaitArguments {
	issues: ReadonlyArray<string>
	owner: number | undefined
}

interface RawAwaitArguments {
	positionals: Array<string>
	values: { owner?: string | undefined }
}

// Injectable for testing -- the CLI never overrides these.
interface AwaitOptions {
	is_running?: (issue: string) => boolean
	is_shipped?: (issue: string, since_ms: number) => boolean
	is_settled?: (issue: string) => Promise<boolean>
	poll_ms?: number
	reconfirm_ms?: number
	never_appeared_timeout_ms?: number
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

// `is_shipped` is the one disappearance the re-confirm window never has to cover: a ship that ended in
// success merged the child's work, so no cut hand-off can follow it (joshuafolkken/kit#4395).
interface CheckConfig {
	is_running: (issue: string) => boolean
	is_shipped?: (issue: string, since_ms: number) => boolean
	reconfirm_ms: number
	never_appeared_timeout_ms: number
}

interface RunConfig extends CheckConfig {
	is_settled: (issue: string) => Promise<boolean>
	poll_ms: number
	now: () => number
	sleep: (ms: number) => Promise<void>
}

// Three answers, not two: only pgrep's own "no match" exit is `none`. A pgrep that failed or hit its
// timeout never looked, and `run:liveness` answers `undetermined` for it rather than booking a live
// child as stopped. A pgrep that is not installed could never look, so it is refused by name.
function process_trace_default(issue: string): ProcessTrace {
	const pattern = lane_child_invocation.process_pattern(issue)
	const result = spawnSync(PGREP_COMMAND, ['-f', pattern], {
		encoding: 'utf8',
		timeout: PROBE_TIMEOUT_MS,
	})

	process_tools.throw_if_missing(PGREP_COMMAND, result.error)

	if (result.status === PROCESS_FOUND || lane_handoff.is_ship_running(issue, process.cwd())) {
		return PROCESS_ALIVE
	}

	return result.status === PROCESS_NOT_FOUND ? PROCESS_NONE : PROCESS_UNKNOWN
}

function is_process_running_default(issue: string): boolean {
	return process_trace_default(issue) === PROCESS_ALIVE
}

function is_shipped_default(issue: string, since_ms: number): boolean {
	return lane_handoff.is_ship_succeeded(issue, process.cwd(), since_ms)
}

// The same positive evidence `run:liveness` answers `settled` on: the issue closed, or it was parked.
async function is_settled_default(issue: string): Promise<boolean> {
	return (await run_liveness.read_child_settled(issue)) === true
}

// An unknown flag or a flag without its value is `undefined`, which is usage.
function read_await_args(rest: ReadonlyArray<string>): RawAwaitArguments | undefined {
	try {
		return parseArgs({
			args: [...rest],
			allowPositionals: true,
			strict: true,
			options: { owner: { type: 'string' } },
		})
	} catch {
		return undefined
	}
}

// Every positional is an issue number, at least one is given, and `--owner` is a pid.
function is_valid(raw: RawAwaitArguments): boolean {
	const { owner } = raw.values
	const numbers = owner === undefined ? raw.positionals : [...raw.positionals, owner]

	return (
		raw.positionals.length > 0 &&
		numbers.every((value) => issue_number_shape.is_issue_number(value))
	)
}

// The issues to wait on and the waiting session's pid, or `undefined` for anything else.
function parse_arguments(rest: ReadonlyArray<string>): AwaitArguments | undefined {
	const raw = read_await_args(rest)

	if (raw === undefined || !is_valid(raw)) return undefined

	const { owner } = raw.values

	return { issues: raw.positionals, owner: owner === undefined ? undefined : Number(owner) }
}

function make_initial_state(is_settled: boolean): AwaitState {
	return { appeared: false, disappeared_at: undefined, first_polled_at: undefined, is_settled }
}

async function make_states(
	issues: ReadonlyArray<string>,
	is_settled: (issue: string) => Promise<boolean>,
): Promise<Map<string, AwaitState>> {
	const settled = await Promise.all(issues.map(async (issue) => await is_settled(issue)))

	return new Map(issues.map((issue, index) => [issue, make_initial_state(settled[index] === true)]))
}

function resolve_timing(
	options: AwaitOptions,
): Pick<RunConfig, 'never_appeared_timeout_ms' | 'poll_ms' | 'reconfirm_ms'> {
	return {
		poll_ms: options.poll_ms ?? DEFAULT_POLL_MS,
		reconfirm_ms: options.reconfirm_ms ?? RECONFIRM_MS,
		never_appeared_timeout_ms: options.never_appeared_timeout_ms ?? NEVER_APPEARED_TIMEOUT_MS,
	}
}

function resolve_probes(options: AwaitOptions): Pick<RunConfig, 'is_running' | 'is_shipped'> {
	return {
		is_running: options.is_running ?? is_process_running_default,
		is_shipped: options.is_shipped ?? is_shipped_default,
	}
}

function resolve_options(options: AwaitOptions): RunConfig {
	return {
		...resolve_probes(options),
		is_settled: options.is_settled ?? is_settled_default,
		now: options.now ?? Date.now,
		sleep: options.sleep ?? sleep,
		...resolve_timing(options),
	}
}

function update_liveness(state: AwaitState, is_live: boolean, now_ms: number): void {
	if (!is_live) return

	if (!state.appeared || state.disappeared_at !== undefined) state.alive_since = now_ms

	state.appeared = true
	state.disappeared_at = undefined
}

// Returns the issue when it had already settled before the wait started — it ended and will never
// appear. Otherwise throws if it never appeared within the timeout window, and records the first-seen time.
function check_not_appeared(
	issue: string,
	state: AwaitState,
	now_ms: number,
	timeout_ms: number,
): string | undefined {
	if (state.is_settled === true) return issue

	state.first_polled_at ??= now_ms
	const elapsed_ms = now_ms - state.first_polled_at

	if (elapsed_ms >= timeout_ms) {
		throw new Error(
			`lane child ${issue} never appeared within ${String(timeout_ms / MS_PER_SECOND)}s`,
		)
	}

	return undefined
}

// The ship this run of the child launched succeeded.
function is_own_ship_done(issue: string, state: AwaitState, config: CheckConfig): boolean {
	const { alive_since } = state

	return alive_since !== undefined && config.is_shipped?.(issue, alive_since) === true
}

// A child that appeared and is gone: done at once when its ship succeeded, else once it stayed gone
// past the re-confirm window.
function check_gone(
	issue: string,
	state: AwaitState,
	now_ms: number,
	config: CheckConfig,
): string | undefined {
	if (is_own_ship_done(issue, state, config)) return issue

	state.disappeared_at ??= now_ms

	return now_ms - state.disappeared_at >= config.reconfirm_ms ? issue : undefined
}

// Returns the issue that has confirmed-completed this tick, `undefined` if none yet.
// The `appeared` guard prevents a process that never showed up from being declared done, unless its
// issue had already settled when the wait started.
function check_issue(
	issue: string,
	state: AwaitState,
	now_ms: number,
	config: CheckConfig,
): string | undefined {
	const is_live = config.is_running(issue)

	update_liveness(state, is_live, now_ms)

	if (is_live) return undefined

	if (!state.appeared) {
		return check_not_appeared(issue, state, now_ms, config.never_appeared_timeout_ms)
	}

	return check_gone(issue, state, now_ms, config)
}

function check_any(
	states: Map<string, AwaitState>,
	now_ms: number,
	config: CheckConfig,
): string | undefined {
	for (const [issue, state] of states) {
		const result = check_issue(issue, state, now_ms, config)

		if (result !== undefined) return result
	}

	return undefined
}

async function wait_for_any(
	issues: ReadonlyArray<string>,
	options: AwaitOptions = {},
): Promise<string> {
	const config = resolve_options(options)
	const states = await make_states(issues, config.is_settled)

	return await poll.wait_for(() => check_any(states, config.now(), config), {
		interval_ms: config.poll_ms,
		sleeper: config.sleep,
	})
}

const lane_await = {
	NEVER_APPEARED_TIMEOUT_MS,
	RECONFIRM_MS,
	check_issue,
	is_process_running_default,
	is_shipped_default,
	parse_arguments,
	process_trace_default,
	wait_for_any,
}

export type { AwaitArguments, AwaitState, CheckConfig }
export { lane_await }
