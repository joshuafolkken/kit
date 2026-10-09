import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { own_session } from '#scripts/cost-runtime/own-session'
import type { CarryOwner, RunCarry } from './run-carry'

// **A conversation outlives its process, so an owner named by a pid alone dies too early.** The carry
// record names the agent process spending the budget, and that is right while the process lives — but
// an interactive conversation is not its process. An extension-host restart ends the process and the
// same conversation resumes seconds later in a new one (`--resume=<id>`), writing on into the same
// transcript; read by pid alone, `run:wake` would recover the record as a crash and dispatch a second
// lane child for the issue the conversation is still running.
//
// **The transcript is what persists across the restart, so it is the second half of the identity.**
// Every resume path — the extension's `--resume=<id>`, a person's `claude -c` — appends to the one
// file named by the session id, and nothing else writes it. So a record also names its owner's
// transcript, and a dead pid whose transcript was written inside the quiet window below is a
// conversation still being continued rather than a crash. Matching the transcript is also how the
// resumed conversation is recognized as the record's own owner, so it can keep counting.
//
// **A hand-off ends the conversation's claim.** A record `--cut` handed off is waited on by the pid
// alone, because the cutting conversation is meant to end there — counted by its transcript, the
// supervisor would hold every cut for the whole window after the cutting process had already exited.

// How long after its last write a conversation whose process has gone still counts as continuing. It
// bridges a restart and a resume — measured at eighteen seconds — with room for a person reopening a
// window, and it is the order of the wake grace window, so a genuine crash is recovered no later than
// a lost wake would be retried.
const CONVERSATION_QUIET_MS = 600_000

type Environment = Readonly<Record<string, string | undefined>>

// The calling session's own transcript, or `undefined` outside a session or when its file cannot be
// found. **The id comes from the environment, which a detached supervisor never inherits**
// (`agent-session-environment.ts` strips it), so a record the supervisor adopts names no transcript.
function own_transcript(
	environment: Environment = process.env,
	directories: ReadonlyArray<string> = cost_transcript.transcript_directories(process.cwd()),
): string | undefined {
	const session_id = own_session.session_id_of(environment)

	if (session_id === undefined) return undefined

	const name = `${session_id}${cost_transcript.TRANSCRIPT_EXTENSION}`

	return directories.map((directory) => path.join(directory, name)).find((file) => existsSync(file))
}

function modified_ms(transcript: string): number | undefined {
	try {
		return statSync(transcript).mtimeMs
	} catch {
		return undefined
	}
}

function is_recent(modified: number | undefined, now: Date): boolean {
	return modified !== undefined && now.getTime() - modified <= CONVERSATION_QUIET_MS
}

function is_conversation_live(
	carry: RunCarry,
	now: Date = new Date(),
	read_modified: (transcript: string) => number | undefined = modified_ms,
): boolean {
	if (carry.is_handed_off === true || carry.owner_transcript === undefined) return false

	return is_recent(read_modified(carry.owner_transcript), now)
}

function is_same_conversation(carry: RunCarry, owner: CarryOwner): boolean {
	return owner.transcript !== undefined && owner.transcript === carry.owner_transcript
}

// The record with its owner moved to the caller's process when the caller is the same conversation in
// a new one, so the record goes on naming a live process once the conversation falls quiet. A record a
// cut handed off is the successor's to take, never the cutting conversation's to take back.
function reclaim_owner(carry: RunCarry, owner: CarryOwner): RunCarry {
	if (carry.is_handed_off === true || !is_same_conversation(carry, owner)) return carry
	if (owner.pid === carry.owner_pid) return carry

	return { ...carry, owner_pid: owner.pid, owner_start: owner.start }
}

const run_carry_conversation = {
	CONVERSATION_QUIET_MS,
	own_transcript,
	is_conversation_live,
	is_same_conversation,
	reclaim_owner,
}

export { run_carry_conversation }
