import { agent_argv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { claude_agent_argv } from '#scripts/agent/claude-agent-argv'
import { detached_launch, type LaunchArgv } from './detached-launch'
import { run_invocation } from './run-invocation'

// How the supervisor starts things: the next agent session, and — at `--start` — its own detached
// self. Both go through one `launch`, because the two differ only in what is being run
// (joshuafolkken/kit#1719).
//
// **The launch itself is no longer this file's** (joshuafolkken/kit#1749). `detached-launch.ts` holds
// it, because a delegated child dispatched into a lane needs the same mechanism and none of the
// invocation parsing this supervisor needs. What stays here is the constants naming the agent CLI and
// the two argument vectors this supervisor composes.
//
// **The invocation grammar is no longer this file's either** (joshuafolkken/kit#1774; folded into
// `backlogrun` by joshuafolkken/kit#1984). `run-carry.ts` reads the same grammar to say which of a
// `backlogrun`'s named issues are still outstanding — so it is `run-invocation.ts`'s, imported
// rather than restated. What that move does **not** change is the rebuild-from-constants design: the
// text handed to the agent CLI is still composed out of that module's own constants and validated
// integers, and the recorded string still never reaches `spawn`.
//
// **The agent CLI is a constant, not configuration, and it is the Claude adapter's constant.** It was
// an environment variable first (`JOSH_WAKE_COMMAND`), which put the choice of *which binary runs* in
// reach of anything that can set an environment — and this binary runs unattended, overnight, in the
// person's own checkout with the person's own credentials. Shape-checking the name does not address
// that; removing the choice does. The two names below are aliases of that one constant rather than a
// second copy of it (joshuafolkken/kit#1749).
//
// **The waker adds nothing to what may be run.** The argument vector is the constant command plus an
// invocation rebuilt to say exactly what the record said, and nothing here writes a label: `auto-ok`
// stays a person's to apply, so a woken session is offered by exactly the rules the first one was. A
// pool that grew across the seam is `backlogrun-steps.md` → "What one invocation approves", not the
// waker's doing (joshuafolkken/kit#1675).
const WAKE_COMMAND = claude_agent_argv.AGENT_COMMAND
const WAKE_FLAGS = claude_agent_argv.AGENT_FLAGS
const LOOP_FLAG = '--loop'
const INTERVAL_FLAG = '--interval'
const SUPERVISOR_SESSION = 'run-wake-supervisor'

function scheduler_profile(): AgentProfile | undefined {
	const resolved = agent_role_profile.resolve(agent_role_profile.SCHEDULER)
	if (resolved.kind === 'profile') return resolved.profile

	console.error(resolved.note)

	return undefined
}

function supervisor_environment(profile: AgentProfile): Record<string, string> {
	return profile.provider === 'openai'
		? { CODEX_THREAD_ID: SUPERVISOR_SESSION }
		: { CLAUDE_CODE_CHILD_SESSION: SUPERVISOR_SESSION }
}

// **What comes back is always the rebuilt text, and it is refused unless it matches the record.** The
// two requirements are separate. Returning the rebuilt string is what severs the flow from the file;
// requiring it to match is what keeps the wake usable, because the woken session hands its prompt
// straight back to `run:carry --begin`, where `is_handed_off_to` compares it to the record character
// for character. A record the rebuild would rewrite — odd spacing, or a value written `05` — is
// therefore refused here, and the supervisor stops at once with a note, where waking on it would launch
// three sessions that each decline to claim the record and take half an hour to say so.
//
// It goes on the command line last and as one argument, never interpolated into a command string: it is
// the prompt the woken session is given, not a list of arguments to the agent CLI. The split happens
// here, to read the record; the pieces are one argument again before they leave.
function safe_invocation(invocation: string): string | undefined {
	if (!detached_launch.is_safe_value(invocation)) return undefined

	const rebuilt = run_invocation.rebuild(invocation)

	return rebuilt === invocation ? rebuilt : undefined
}

// **The two failure modes are kept apart, not folded into one `undefined`** (joshuafolkken/kit#1932).
// An unmatched or unsafe invocation is `undefined` and the caller names it as one; a rejected effort
// override carries the role resolver's own note through the `rejected` variant, so a
// `JOSH_SCHEDULER_EFFORT` typo is reported as the env typo it is rather than as unreadable carried text.
function profiled_argv(invocation: string, profile: AgentProfile, cwd?: string): AgentArgvResult {
	return cwd === undefined
		? agent_argv.with_profile(invocation, profile)
		: agent_argv.with_profile_in(invocation, profile, cwd)
}

function resolved_argv(invocation: string, cwd?: string): AgentArgvResult {
	return cwd === undefined
		? agent_argv.resolve(invocation, agent_role_profile.SCHEDULER)
		: agent_argv.resolve_in(invocation, agent_role_profile.SCHEDULER, cwd)
}

function wake_argv(
	invocation: string,
	profile?: AgentProfile,
	cwd?: string,
): AgentArgvResult | undefined {
	const matched = safe_invocation(invocation)
	if (matched === undefined) return undefined

	return profile === undefined ? resolved_argv(matched, cwd) : profiled_argv(matched, profile, cwd)
}

// Re-invoking this very script under the same runner, which is what makes the supervisor outlive the
// session that started it. `execArgv` is carried across rather than dropped, because the loader flags
// are what let the runner execute a TypeScript entry point at all — without them the detached process
// starts and immediately fails on the syntax.
//
// **The interval is forwarded rather than dropped.** `--start --interval 15` accepts the flag, so a
// supervisor that then polled at the default would be silently ignoring what it was told.
function supervisor_argv(script_path: string, interval?: string): LaunchArgv {
	const chosen = interval === undefined ? [] : [INTERVAL_FLAG, interval]

	return {
		command: process.execPath,
		args: [...process.execArgv, script_path, LOOP_FLAG, ...chosen],
	}
}

// **`ensure_log`, `is_safe_argv` and `launch` are re-exported rather than reimplemented.** They are
// `detached-launch.ts`'s now; naming them here keeps `run:wake`'s own callers reading one namespace,
// and there is exactly one implementation behind both names (joshuafolkken/kit#1749).
const run_wake_session = {
	INTERVAL_FLAG,
	LOOP_FLAG,
	WAKE_COMMAND,
	WAKE_FLAGS,
	ensure_log: detached_launch.ensure_log,
	is_safe_argv: detached_launch.is_safe_argv,
	launch: detached_launch.launch,
	scheduler_profile,
	supervisor_argv,
	supervisor_environment,
	wake_argv,
}

export type { LaunchRequest, LaunchResult } from './detached-launch'
export { run_wake_session }
