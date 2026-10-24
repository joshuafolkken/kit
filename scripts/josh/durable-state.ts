import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state_migrate } from '#scripts/josh/durable-state-migrate'
import { PLATFORM_TEMP_ROOT, platform_temporary } from '#scripts/josh/platform-temporary'
import { stamp_file } from '#scripts/josh/stamp-file'

// **Which record goes where — the one place this is decided.** A record a run has to read again after
// the machine restarts lives here, in the common git directory: the carry and ended records, the event
// stream, the lane state and ledger, the wake log, the backlogrun launch record and log, the detached
// ship's log and result, and a lane child's dispatch log. macOS empties `/tmp` on every boot, and losing them
// there left the open lanes stateless, the merge statistics empty and a parked ship's failure
// unreadable. Everything that means nothing past the process that wrote it — a lock, a pid, a socket,
// a per-process cache — stays in `PLATFORM_TEMP_ROOT`, where a reboot clearing it is the right answer.
//
// **The common git directory rather than the home directory**, because a Codex lane's sandbox reads
// `$HOME` but may write the common git directory (`codex-agent-argv.ts`), and every lane of one
// repository shares it. A repository's own clone is also where `review-stops.jsonl` already lives.
// Outside a repository there is no such directory, and the record falls back to the temp root.
//
// **Records a run left in `/tmp` are copied in once per directory, and a log not written for two
// weeks is removed** (`durable-state-migrate.ts`).
//
// **`JOSH_TEMP_ROOT` moves this root too**, into a directory of its own beneath the override, so the unit
// suite's network guard keeps every record of a test run out of the live one exactly as before.
const RUN_STATE_DIRECTORY = 'run-state'
const OVERRIDE_STATE_DIRECTORY = 'josh-state'
const STATE_DIRECTORY_MODE = 0o700

function state_root(override: string | undefined, common: string | undefined): string {
	if (override !== undefined && override !== '') {
		return path.join(override, OVERRIDE_STATE_DIRECTORY)
	}

	if (common === undefined) return PLATFORM_TEMP_ROOT

	return path.join(common, git_common_directory.STATE_DIRECTORY, RUN_STATE_DIRECTORY)
}

// Read once at import, as `PLATFORM_TEMP_ROOT` is, so both roots answer for the same override.
const STATE_ROOT_OVERRIDE = process.env[platform_temporary.TEMP_ROOT_KEY]

// The root for a named common git directory — what a launcher grants a sandboxed child before it runs.
function root_for(common: string | undefined): string {
	return state_root(STATE_ROOT_OVERRIDE, common)
}

function root(): string {
	return root_for(git_common_directory.repository())
}

// Every record kept here, by the prefix of its file name — the list the one-time copy from `/tmp`
// walks, so a record added here is carried over with the rest.
const PREFIX = {
	CARRY: 'josh-run-carry-',
	ENDED: 'josh-run-ended-',
	EVENTS: 'josh-run-events-',
	LANE_STATE: 'josh-lane-state-',
	LANE_LEDGER: 'josh-lane-ledger-',
	WAKE_LOG: 'josh-run-wake-log-',
	BACKLOGRUN_LAUNCH: 'josh-backlogrun-launch-',
	BACKLOGRUN_LOG: 'josh-backlogrun-log-',
	SHIP_LOG: 'josh-ship-log-',
	SHIP_RESULT: 'josh-ship-result-',
	LANE_DISPATCH: 'josh-lane-dispatch-',
} as const

const PREFIXES: ReadonlyArray<string> = Object.values(PREFIX)

// Directories this process has already made ready, so the upkeep runs once rather than per lookup.
const ensured = new Set<string>()

function prepare(directory: string): void {
	mkdirSync(directory, { recursive: true, mode: STATE_DIRECTORY_MODE })
	durable_state_migrate.copy_once(PLATFORM_TEMP_ROOT, directory, PREFIXES)
	durable_state_migrate.prune_stale_logs(directory, PREFIXES, Date.now())
}

// **A directory that cannot be created answers the temp root rather than throwing** — a sandbox that
// may not write the common git directory still runs, with the records `/tmp` always held.
function ensure(directory: string): string {
	if (ensured.has(directory)) return directory

	try {
		prepare(directory)
	} catch {
		return PLATFORM_TEMP_ROOT
	}

	ensured.add(directory)

	return directory
}

// The durable counterpart of `stamp_file.stamp_path`: the same per-account, per-key file name, in the
// directory above. The directory is created on the way, private to the account.
function durable_path(prefix: string, key_root: string, suffix?: string): string {
	return path.join(ensure(root()), stamp_file.stamp_name(prefix, key_root, suffix))
}

const durable_state = {
	PREFIX,
	STATE_DIRECTORY_MODE,
	ensure,
	path: durable_path,
	root,
	root_for,
	state_root,
}

export { durable_state }
