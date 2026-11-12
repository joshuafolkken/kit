import { existsSync } from 'node:fs'
import { agent_provider, type AgentProvider } from '#scripts/agent/agent-provider'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_carry, type CarryOwner, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_conversation } from '#scripts/run/carry/run-carry-conversation'
import { run_carry_reclaim } from '#scripts/run/carry/run-carry-reclaim'

// The supervisor's hand-off to a judgment session it is about to wake (joshuafolkken/kit#5743).
//
// **The supervisor claims the record for the session, so the session never claims it.** Before the
// launch it adopts the record for the session-to-be, named by the transcript its forced session id
// writes; after the launch it moves the owner to the launched process, so the supervisor's own
// `is_owner_live` reads the session as at work and decides `wait`. The session's counts land as the
// record's owner from its first command, with no `run:carry --resume` round trip. The adoption is
// written before the launch, never after: a count from a session that boots fast enough would
// otherwise meet a record still the supervisor's.
//
// The adoption also recovers a record whose owner died without a cut (`run-wake.ts` →
// `decide_not_handed_off`): it rewrites the owner and clears any hand-off, whoever held it.
//
// **A Codex session cannot be given its session id** (`agent-argv.ts` → `build`), so neither its
// transcript nor its pid is known here: it is adopted with the pid-less owner `run:carry --resume`
// writes for it, and its pid is never moved onto the record — a pid it cannot match would make its
// own counts a foreign live owner's.
//
// `hand_off` is the older recovery the backlog preflight still runs: it marks the record handed off,
// as a `--cut` does, so a later claim over it reads `resume` rather than `standing`.

interface WakeSession {
	worktree: string
	session_id: string
	provider: AgentProvider
}

function session_owner(session: WakeSession): CarryOwner {
	if (session.provider === agent_provider.OPENAI_PROVIDER) return { is_headless: true }

	const directory = cost_transcript.transcript_directory(session.worktree)
	const transcript = run_carry_conversation.transcript_of(session.session_id, directory)

	return { transcript, is_headless: true }
}

// The preflight's recovery (`backlog-preflight.ts`): it writes the `is_handed_off` a `--cut` writes,
// only where the record is `carried` and not already handed off, keeping its counters.
function hand_off(target: string): void {
	const read = run_carry.read_carry(target)

	if (read.kind !== 'carried' || read.carry.is_handed_off === true) return

	stamp_file.replace_stamp(target, { ...read.carry, is_handed_off: true })
}

// The record keeps the provider its scheduler wakes with, as the driver's own claim keeps it.
function hand_to(target: string, owner: CarryOwner): void {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return

	run_carry.adopt_carry(target, read.carry, { ...owner, provider: read.carry.scheduler_provider })
}

// Through `reclaim_at`, so the transcript the adoption named is what lets the pid move — one writer.
function hand_on(target: string, owner: CarryOwner, pid: number): void {
	if (owner.transcript === undefined) return

	run_carry_reclaim.reclaim_at(target, run_carry.owner_of(pid, undefined, owner.transcript))
}

// **The launched pid is the supervisor's own write, so it is no sign the session picked the run up**:
// until the transcript the adoption named exists, a live pid is read as a wake still pending, and the
// grace, retry and warning of `run-wake.ts` → `decide_launch` still catch a session that hangs in boot.
function has_session_begun(carry: RunCarry): boolean {
	return carry.owner_transcript === undefined || existsSync(carry.owner_transcript)
}

const run_wake_handoff = { hand_off, session_owner, hand_to, hand_on, has_session_begun }

export type { WakeSession }
export { run_wake_handoff }
