import { backlog_budget_cli } from '#scripts/backlog/backlog-budget-cli'
import { detached_launch, type LaunchArgv } from './detached-launch'

// How the supervisor starts things: the next agent session, and — at `--start` — its own detached
// self. Both go through one `launch`, because the two differ only in what is being run
// (joshuafolkken/kit#1719).
//
// **The launch itself is no longer this file's** (joshuafolkken/kit#1749). `detached-launch.ts` holds
// it, because a delegated child dispatched into a lane needs the same mechanism and none of the
// `backlogrun` invocation parsing below. What stays here is that parsing, the constants naming the
// agent CLI, and the two argument vectors this supervisor composes.
//
// **The agent CLI is a constant, not configuration, and it is `detached-launch.ts`'s constant.** It was
// an environment variable first (`JOSH_WAKE_COMMAND`), which put the choice of *which binary runs* in
// reach of anything that can set an environment — and this binary runs unattended, overnight, in the
// person's own checkout with the person's own credentials. Shape-checking the name does not address
// that; removing the choice does. The two names below are aliases of that one constant rather than a
// second copy of it (joshuafolkken/kit#1749).
//
// **The waker adds nothing to what may be run.** The argument vector is the constant command plus an
// invocation rebuilt to say exactly what the record said, and nothing here writes a label: `auto-ok`
// stays a person's to apply, so a woken session is offered by exactly the rules the first one was. A
// pool that grew across the seam is `backlogrun.md` → "What one invocation approves", not the
// waker's doing (joshuafolkken/kit#1675).
const WAKE_COMMAND = detached_launch.AGENT_COMMAND
const WAKE_FLAGS = detached_launch.AGENT_FLAGS
const LOOP_FLAG = '--loop'
const INTERVAL_FLAG = '--interval'

// **The invocation is taken apart and rebuilt, rather than inspected and handed on.** This supervisor
// wakes a `backlogrun` and nothing else, so everything that may reach the operating system is
// enumerable: one command word, two flag names, and an integer for each. Reading the record as tokens
// and composing a fresh string out of constants and validated integers means the text the record held
// never reaches `spawn` at all.
//
// **A stricter check is not a break in the flow, and that is why three of them changed nothing.**
// Validating the characters, fixing the binary as a constant and matching against a pattern all left
// the recorded string flowing into the call; taint tracking follows where a value goes, not how hard
// it was looked at on the way. Composing the argument from constants is what actually severs it — and
// it retires the pattern the previous shape needed, whose alternation CodeQL found could backtrack
// exponentially (joshuafolkken/kit#1719).
const INVOCATION_COMMAND = 'backlogrun'
// The flags this supervisor knows how to carry across a session cut. A token is compared against these
// and the **constant that matched** is what goes into the rebuilt invocation, never the token itself:
// the two are equal as text and differ in where they came from, and here the origin is the whole point.
const KNOWN_FLAGS: ReadonlyArray<string> = ['--max', '--idle']
const TOKEN_SEPARATOR = ' '
const FIRST_TOKEN = 0
const FIRST_FLAG_INDEX = 1
const VALUE_OFFSET = 1
const FLAG_PAIR_LENGTH = 2
const EMPTY_LENGTH = 0

// One flag of a parsed invocation: a name taken from `KNOWN_FLAGS` and a number. Neither field can
// hold text that came out of the record, which is what makes rebuilding from it safe by construction.
interface InvocationPart {
	flag: string
	value: number
}

type InvocationParts = ReadonlyArray<InvocationPart>

// Returns the constant that the token equals, so that what is carried forward is this file's own text.
function known_flag(token: string): string | undefined {
	return KNOWN_FLAGS.find((flag) => flag === token)
}

// **The integer check is `backlog:budget`'s own, imported rather than restated.** It is the command
// this invocation is going to be handed to, so a second copy of the rule here would be free to drift
// from the one that actually reads the number.
function invocation_part(token: string, raw: string | undefined): InvocationPart | undefined {
	const flag = known_flag(token)
	const value = backlog_budget_cli.to_count(raw)

	if (flag === undefined || value === undefined) return undefined

	return { flag, value }
}

// **An unknown flag is refused, never dropped.** Dropping one would wake a session running to a budget
// the person did not declare the first time `backlogrun` grows a flag this list has not caught up with
// — which is the failure that is hardest to notice, because the session runs and looks fine.
function invocation_parts(tokens: ReadonlyArray<string>): InvocationParts | undefined {
	const parts: Array<InvocationPart> = []

	for (let index = FIRST_FLAG_INDEX; index < tokens.length; index += FLAG_PAIR_LENGTH) {
		const part = invocation_part(tokens[index] ?? '', tokens[index + VALUE_OFFSET])

		if (part === undefined) return undefined

		parts.push(part)
	}

	return parts
}

// A space is the only separator that can survive `is_safe_value`, which has already refused every
// control character — so the split needs no pattern, and the file is left with no regular expression
// for a backtracking analysis to find.
function tokens_of(invocation: string): ReadonlyArray<string> {
	return invocation.split(TOKEN_SEPARATOR).filter((token) => token.length > EMPTY_LENGTH)
}

function rebuilt_invocation(parts: InvocationParts): string {
	const rendered = parts.map((part) => `${part.flag} ${String(part.value)}`)

	return [INVOCATION_COMMAND, ...rendered].join(TOKEN_SEPARATOR)
}

function parsed_invocation(invocation: string): string | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== INVOCATION_COMMAND) return undefined

	const parts = invocation_parts(tokens)

	return parts === undefined ? undefined : rebuilt_invocation(parts)
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

	const rebuilt = parsed_invocation(invocation)

	return rebuilt === invocation ? rebuilt : undefined
}

function wake_argv(invocation: string): LaunchArgv | undefined {
	const matched = safe_invocation(invocation)

	if (matched === undefined) return undefined

	return detached_launch.agent_argv(matched)
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
	supervisor_argv,
	wake_argv,
}

export type { LaunchArgv as WakeArgv, LaunchRequest, LaunchResult } from './detached-launch'
export { run_wake_session }
