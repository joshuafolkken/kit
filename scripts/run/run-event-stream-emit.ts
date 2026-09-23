import { git_command } from '#scripts/git/git-command'
import { run_event_stream } from './run-event-stream'

// The write side of the run's event stream (joshuafolkken/kit#2205). It resolves the run's identity and
// appends, and it is where the "reporting must not break the work it reports on" contract is kept: every
// failure — a git call that hangs, a temp directory that cannot be written — is swallowed, so a lane
// child's own work never fails because an append did.
//
// **The key is `run-carry.ts`'s, not `run-progress-clock.ts`'s.** The report clock keys on the work
// tree's own git directory because two lanes are two clocks; this stream is the opposite — the parent
// session, a cut successor and every lane child are one run and append to one stream — so it keys on the
// common git directory the carry record uses, which every lane of one repository shares.

// The common git directory: `.git` in the main work tree and the same `.git` from inside a lane, the
// second of the two paths `git_directories` prints. `run-carry.ts` reads exactly this index for exactly
// this reason.
const REPOSITORY_DIRECTORY_INDEX = 1

function now_iso(): string {
	return new Date().toISOString()
}

/**
 * The stream's path for the run this checkout belongs to, or `undefined` when there is no git
 * repository to key on — outside one there is no run identity, and no stream.
 */
async function stream_target(): Promise<string | undefined> {
	const directories = await git_command.git_directories()
	const repository = directories[REPOSITORY_DIRECTORY_INDEX]

	return repository === undefined ? undefined : run_event_stream.target_of(repository)
}

/**
 * Append one session-facing event, best-effort. A kind outside the enumeration is refused by `append`;
 * every error is swallowed, because the reporting path must never fail the work it reports on
 * (joshuafolkken/kit#2205).
 */
async function emit(kind: string, text: string): Promise<void> {
	try {
		const target = await stream_target()

		if (target === undefined) return

		run_event_stream.append(target, kind, text, now_iso())
	} catch {
		// Reporting is best-effort: a failed append is dropped rather than raised into the caller's work.
	}
}

/**
 * Append one event unless the newest event on the stream already carries this kind — so a marker a loop
 * re-checks every poll is written once per episode rather than once per poll (joshuafolkken/kit#2335).
 * The drain marker is the caller: `backlog:offer` runs every iteration of a watching loop, and one drain
 * event per drain is what `run:step` reads to fire the retrospective a single time. Best-effort like
 * `emit`: a failed resolve or read is swallowed rather than raised into the loop's work.
 *
 * **Returns whether it appended**, so a caller that pairs the marker with its own once-per-episode side
 * effect — the stall detector sends one notification per stall (joshuafolkken/kit#2359) — fires that
 * effect exactly when the marker was fresh. A skipped duplicate and a swallowed failure both read
 * `false`: neither is a fresh episode.
 */
async function emit_once(kind: string, text: string): Promise<boolean> {
	try {
		const target = await stream_target()

		if (target === undefined || run_event_stream.read_last(target)?.kind === kind) return false

		return run_event_stream.append(target, kind, text, now_iso()).appended
	} catch {
		// Best-effort: a failed append is dropped rather than raised into the loop's work.
		return false
	}
}

// One progress heartbeat line onto the stream, so a relay reaches it across a cut (joshuafolkken/kit#2437).
async function emit_heartbeat(line: string): Promise<void> {
	await emit(run_event_stream.EVENT_KIND.HEARTBEAT, line)
}

const run_event_stream_emit = { emit, emit_heartbeat, emit_once, stream_target }

export { run_event_stream_emit }
