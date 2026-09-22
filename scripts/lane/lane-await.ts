import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { lane_child_invocation } from './lane-child-invocation'

// Detached lane children are not harness-tracked processes, so their completion fires no
// re-invocation event in the parent's session. Without a blocking wait the parent notices only
// on the next heartbeat interval -- up to 15 minutes after the fact in the measured case
// (joshuafolkken/kit#2113).
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
const MS_PER_SECOND = 1000
const ISSUE_PATTERN = /^[1-9]\d*$/u
const PROCESS_FOUND = 0

interface AwaitState {
	appeared: boolean
	disappeared_at: number | undefined
	first_polled_at: number | undefined
}

// Injectable for testing -- the CLI never overrides these.
interface AwaitOptions {
	is_running?: (issue: string) => boolean
	poll_ms?: number
	reconfirm_ms?: number
	never_appeared_timeout_ms?: number
}

interface CheckConfig {
	is_running: (issue: string) => boolean
	reconfirm_ms: number
	never_appeared_timeout_ms: number
}

interface RunConfig extends CheckConfig {
	poll_ms: number
}

function is_process_running_default(issue: string): boolean {
	const invocation = lane_child_invocation.child_invocation(issue)
	const result = spawnSync('pgrep', ['-f', `${invocation}$`], { encoding: 'utf8' })

	return result.status === PROCESS_FOUND
}

function make_initial_state(): AwaitState {
	return { appeared: false, disappeared_at: undefined, first_polled_at: undefined }
}

function make_states(issues: ReadonlyArray<string>): Map<string, AwaitState> {
	return new Map(issues.map((issue) => [issue, make_initial_state()]))
}

function resolve_options(options: AwaitOptions): RunConfig {
	return {
		is_running: options.is_running ?? is_process_running_default,
		poll_ms: options.poll_ms ?? DEFAULT_POLL_MS,
		reconfirm_ms: options.reconfirm_ms ?? RECONFIRM_MS,
		never_appeared_timeout_ms: options.never_appeared_timeout_ms ?? NEVER_APPEARED_TIMEOUT_MS,
	}
}

function update_liveness(state: AwaitState, is_live: boolean): void {
	if (!is_live) return

	state.appeared = true
	state.disappeared_at = undefined
}

// Throws if the issue never appeared within the timeout window; otherwise records the first-seen time.
function check_not_appeared(
	issue: string,
	state: AwaitState,
	now_ms: number,
	timeout_ms: number,
): void {
	state.first_polled_at ??= now_ms
	const elapsed_ms = now_ms - state.first_polled_at

	if (elapsed_ms >= timeout_ms) {
		throw new Error(
			`lane child ${issue} never appeared within ${String(timeout_ms / MS_PER_SECOND)}s`,
		)
	}
}

// Returns the issue that has confirmed-completed this tick, `undefined` if none yet.
// The `appeared` guard prevents a process that never showed up from being declared done.
function check_issue(
	issue: string,
	state: AwaitState,
	now_ms: number,
	config: CheckConfig,
): string | undefined {
	const is_live = config.is_running(issue)

	update_liveness(state, is_live)

	if (is_live) return undefined

	if (!state.appeared) {
		check_not_appeared(issue, state, now_ms, config.never_appeared_timeout_ms)

		return undefined
	}

	if (state.disappeared_at === undefined) {
		state.disappeared_at = now_ms

		return undefined
	}

	return now_ms - state.disappeared_at >= config.reconfirm_ms ? issue : undefined
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
	const states = make_states(issues)

	for (;;) {
		const completed = check_any(states, Date.now(), config)

		if (completed !== undefined) return completed

		await sleep(config.poll_ms)
	}
}

const lane_await = {
	ISSUE_PATTERN,
	NEVER_APPEARED_TIMEOUT_MS,
	RECONFIRM_MS,
	check_issue,
	wait_for_any,
}

export type { AwaitState, CheckConfig }
export { lane_await }
