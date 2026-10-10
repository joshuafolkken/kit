import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import type { CarryRead } from './run-carry'

// The run `run:carry --end` last ended. `--end` removes the carry record, whose `started_at` is the only
// mark of where an invocation began on the shared event stream, so without this `run:board` would lose
// the finished run the moment it ended. This keeps the three facts the board needs to redraw that run —
// what it was asked to do, when it began and when it ended — read from a record rather than guessed on
// screen.
//
// **A stopped run also keeps why it stopped and the session that ran it**, so the board can offer the command that resumes that session to the person the stop waits on. The
// session is the owner's transcript name, which is the Claude session id; a run with no transcript —
// a Codex parent — keeps none.
//
// **One record, overwritten by the next `--end`**: the board keeps only the run before the next one, and
// a run that begins replaces nothing here — its carry record is what the board reads while it runs.

const ENDED_PREFIX = 'josh-run-ended-'
const TRANSCRIPT_SUFFIX = '.jsonl'

const ended_run_schema = z.object({
	invocation: z.string(),
	started_at: z.string(),
	ended_at: z.string(),
	stopped: z.string().optional(),
	session: z.string().optional(),
})

type EndedRun = z.infer<typeof ended_run_schema>

// Keyed on the common git directory, as the carry record is, so every lane reads the same one.
function ended_path(git_directory: string): string {
	return stamp_file.stamp_path(ENDED_PREFIX, git_directory)
}

function session_of(transcript: string | undefined): string | undefined {
	return transcript === undefined ? undefined : path.basename(transcript, TRANSCRIPT_SUFFIX)
}

// The stop's reason and session, only for a run that stopped: a clean end has nobody to resume for.
function stop_of(
	transcript: string | undefined,
	stopped: string | undefined,
): Pick<EndedRun, 'stopped' | 'session'> {
	return stopped === undefined ? {} : { stopped, session: session_of(transcript) }
}

// Records the run a `--end` is about to remove. A read with no record — `none` or `unreadable` — names
// no run, so it leaves the previous record standing rather than erasing it.
function record_ended(
	target: string,
	read: CarryRead,
	now: Date = new Date(),
	stopped?: string,
): void {
	if (read.kind !== 'carried' && read.kind !== 'expired') return

	const { invocation, started_at, owner_transcript } = read.carry
	const ended_at = now.toISOString()

	stamp_file.replace_stamp(target, {
		invocation,
		started_at,
		ended_at,
		...stop_of(owner_transcript, stopped),
	})
}

function parse_ended(raw: string): EndedRun | undefined {
	return json_value.parse_with(raw, ended_run_schema)
}

// `undefined` when no run has ended here, or the record does not read.
function read_ended(target: string): EndedRun | undefined {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? undefined : parse_ended(raw)
}

const run_carry_ended = { ended_path, read_ended, record_ended }

export { run_carry_ended }
export type { EndedRun }
