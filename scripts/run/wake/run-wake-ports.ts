import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_withdraw_closed } from '#scripts/lane/lane-withdraw-closed'
import { poll } from '#scripts/lib/poll'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_headless } from '#scripts/run/run-headless'
import type { WakeContext } from './run-wake-describe'
import { run_wake_driver } from './run-wake-driver'
import { run_wake_handoff } from './run-wake-handoff'
import type { LoopPorts } from './run-wake-loop'
import { run_wake_session, type LaunchResult } from './run-wake-session'

// The production ports of the supervisor's loop (`run-wake-loop.ts` → `LoopPorts`), and the session
// launch they wake through.

// **The note covers both ways `wake_argv` answers `undefined`**, because it cannot tell them apart and
// a message that named only the first would accuse a legitimate invocation of carrying unsafe text.
// The second is the one a person actually meets: a `queue` whose references carry a `owner/repo#`
// prefix is a grammar this supervisor does not rebuild, and `queue.md` → "The session boundary" is why
// such a queue begins no record in the first place.
const UNSAFE_INVOCATION_NOTE =
	'the carried invocation is not one this supervisor can continue — it is neither a backlogrun nor a queue it can rebuild, or it carries text that may not be passed to a command line'

function note_to_stderr(note: string): void {
	console.error(`wake: ${note}`)
}

// **A session that started is said on the stream.** The driver's `waiting on judgment` is the moment it
// asked; from here a session is at work on the answer, until the supervisor's next hand-off.
function say_session_running(context: WakeContext): void {
	run_event_setup.emit_to(context.event_target, run_event_setup.STAGE.SESSION, new Date())
}

function wake_session(
	context: WakeContext,
	invocation: string,
	profile: AgentProfile,
	session: { id: string; material: string },
): LaunchResult {
	const built = run_wake_session.wake_argv(invocation, profile, context.worktree, session)

	if (built === undefined) return { kind: 'failed', note: UNSAFE_INVOCATION_NOTE }
	if (built.kind === 'rejected') return { kind: 'failed', note: built.note }

	// The headless mark is what lets the stop hook hold this session's turn open while its lanes run —
	// under `claude -p` a turn-end is the process's end (`run-headless.ts`).
	const environment = run_headless.environment()
	const target = { cwd: context.worktree, env: environment, log_path: context.log_target }
	const result = run_wake_session.launch({ argv: built.argv, ...target, profile }, note_to_stderr)

	if (result.kind === 'launched') say_session_running(context)

	return result
}

// The lanes the supervisor ends each pass: closes left incomplete, and lanes whose issue was closed as
// not planned (`lane-withdraw-closed.ts`), each withdrawal said on stderr.
async function retry_closes(): Promise<void> {
	await lane_close.retry_closes()
	const notes = await lane_withdraw_closed.withdraw_closed()

	for (const note of notes) note_to_stderr(note)
}

// **A record this supervisor owns itself is not a session at work.** A failed driver leaves the record
// adopted for this process, so reading that owner as live would have every restarted pass wait on
// itself and never drive again.
//
// `is_code_stale` defaults to never: only the supervisor's own `--loop` watches its code
// (`run-wake-code.ts`).
function ports_for(
	context: WakeContext,
	profile: AgentProfile,
	is_code_stale: () => Promise<boolean> = async () => false,
): LoopPorts {
	return {
		is_code_stale,
		read_carry: () => run_carry.read_carry(context.carry_target),
		is_owner_live: (read) => read.kind === 'carried' && run_carry.is_held_by_another(read.carry),
		has_work: async () => true,
		new_session_id: () => randomUUID(),
		hand_off: () => {
			run_wake_handoff.hand_off(context.carry_target)
		},
		drive: async () => await run_wake_driver.drive(context.carry_target),
		wake: (invocation, session_id, material) =>
			wake_session(context, invocation, profile, { id: session_id, material }),
		sleep: poll.sleep,
		now: () => new Date(),
		retry_closes,
	}
}

const run_wake_ports = { note_to_stderr, ports_for }

export { run_wake_ports }
