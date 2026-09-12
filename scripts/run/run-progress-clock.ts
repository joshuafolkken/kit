import { git_utilities } from '#scripts/git/constants'
import { stamp_file } from '#scripts/josh/stamp-file'
import { execaSync } from 'execa'
import { z } from 'zod'

// The report clock `josh run:progress` keeps, in the one form both of its readers can use
// (joshuafolkken/kit#1570).
//
// **It exists because a second reader arrived, and that one cannot await.** The watcher reads the
// record between ticks, where an `async` call costs nothing; the trigger-delivered rule that refuses
// an early heartbeat (`scripts/rules/early-heartbeat.ts`) reads it inside a `PreToolUse` hook, whose
// decision is synchronous from payload to envelope. Copying the record's shape into the hook would be
// the clone `CLAUDE.md` prohibits, in the one place where two copies disagreeing means the guard
// silently guards nothing — so the record lives here and each reader brings its own way of naming the
// work tree.
//
// **The key is the work tree's own git directory**, the way `run_hold` keys its record: two lanes of
// one repository are two runs, and one lane's report must not silence the other's clock. The
// synchronous twin asks `git rev-parse --absolute-git-dir`, which is the first of the two lines
// `git_command.git_directories` reads and the one the asynchronous path already takes — so the two
// spellings cannot name different files.

const PROGRESS_PREFIX = 'josh-run-progress-'
// The watcher's own liveness record, kept apart from the report clock above: that one says *when* the
// run last reported and is written on every heartbeat, so it can never double as "should this watcher
// still be running". This one is presence-only — the watcher writes it once when it begins, reads it
// every tick, and ends the moment it is gone, which is how `josh followup` stops a watcher at the
// merge instead of leaving it to wait out its whole bound (joshuafolkken/kit#1821). It reuses the same
// key as the report clock — the work tree's own git directory — so both name one file per run.
//
// **The loop that reads its own record and exits when it is gone is `run-wake-loop.ts`'s `run_loop`
// pattern (joshuafolkken/kit#1727), and the read/write is `stamp_file`.** Neither is re-implemented
// here: this module only names the record, exactly as it names the report clock. Unlike `run-hold`'s
// and `run-carry`'s records it needs no expiry, because it is read only by the one watcher that wrote
// it — never by another run deciding whether a resource is free — so a fresh watcher always overwrites
// a stale one and there is no cross-run read to fall open.
const LIFE_PREFIX = 'josh-run-progress-life-'
// The lookup only ever decides whether a rule speaks, so a git call that hangs must not hold the hook
// that is holding the user's call. A timeout answers `undefined`, which reads as "no clock here" and
// lets the call through — the direction every other failure in this path already takes.
const GIT_TIMEOUT_MS = 5000
// The first of the two lines `git_command.git_directories` reads, asked on its own because that is the
// one the record is keyed on. Asking git rather than assuming a directory named `.git` is what makes a
// linked work tree, a bare repository and a `--separate-git-dir` clone all answer correctly.
const GIT_DIRECTORY_ARGUMENTS: ReadonlyArray<string> = ['rev-parse', '--absolute-git-dir']

const report_stamp_schema = z.object({ reported_at: z.string() })

function parse_stamp(raw: string): number | undefined {
	const parsed = report_stamp_schema.safeParse(JSON.parse(raw))

	if (!parsed.success) return undefined

	const reported_at = Date.parse(parsed.data.reported_at)

	return Number.isNaN(reported_at) ? undefined : reported_at
}

/**
 * When the run last reported anything — a real report through `--mark`, or a line the watcher printed.
 *
 * `undefined` for every unreadable shape. The watcher falls back to the moment it started watching;
 * the guard reads it as "this run has no progress clock" and refuses nothing, which is what keeps an
 * ordinary conversational session outside a rule written for unattended runs.
 */
function read_last_report(target: string): number | undefined {
	const raw = stamp_file.read_stamp_text(target)

	if (raw === undefined) return undefined

	try {
		return parse_stamp(raw)
	} catch {
		return undefined
	}
}

function mark(target: string, now_ms: number): void {
	stamp_file.write_stamp(target, { reported_at: new Date(now_ms).toISOString() })
}

// `undefined` is passed straight through so `stamp_file`'s own default root stands, which is what the
// caller got before this function existed. Hashing an empty string instead would key the record on a
// path no other code path produces.
function stamp_target_of(git_directory: string | undefined): string {
	return stamp_file.stamp_path(PROGRESS_PREFIX, git_directory)
}

// The liveness record's path, keyed the same way as the report clock so the watcher and `josh followup`
// name one file per work tree. A different prefix keeps it a separate file: removing it must not
// disturb the report clock the early-heartbeat guard reads.
function life_target_of(git_directory: string | undefined): string {
	return stamp_file.stamp_path(LIFE_PREFIX, git_directory)
}

// The watcher declares itself alive. `write_stamp` unlinks first, so a fresh `--wait` cleanly replaces
// a record an earlier one left behind. The payload is presence only — nothing reads its contents; the
// existence of the file is the whole signal.
function begin_life(target: string): void {
	stamp_file.write_stamp(target, { alive: true })
}

// **Gone means ended.** `read_stamp_text` answers `undefined` for an absent or unowned record, and the
// only writer is the watcher itself, so absence means `josh followup` removed it — or nobody began
// one. Either way the watcher stops, which is the fail-quiet direction: a watcher that kept running on
// a missing record would be the lingering process joshuafolkken/kit#1821 exists to end.
function is_life_ended(target: string): boolean {
	return stamp_file.read_stamp_text(target) === undefined
}

// What `josh followup` calls at the merge seam, and what the watcher calls when its own bound ends.
// Removing an absent record is a no-op, so it is safe on either side.
function end_life(target: string): void {
	stamp_file.remove_stamp(target)
}

// execa runs the binary directly with an argument array and no `shell` option, so CLI args cannot
// break out of a shell sandbox; the git command and args are internally controlled, never untrusted
// input. tssecurity:S8705 is a false positive here.
function git_directory_sync(): string | undefined {
	const git_binary = git_utilities.get_git_command_for_spawn()
	const result = execaSync(git_binary, GIT_DIRECTORY_ARGUMENTS, {
		reject: false,
		timeout: GIT_TIMEOUT_MS,
	}) // NOSONAR

	if (result.exitCode !== 0) return undefined

	const output = result.stdout.trim()

	return output === '' ? undefined : output
}

function stamp_target_sync(): string | undefined {
	const directory = git_directory_sync()

	return directory === undefined ? undefined : stamp_target_of(directory)
}

/**
 * The clock, read from a place that cannot await — the whole reason this module is separate.
 *
 * It answers about the work tree the caller is standing in. A watcher started in another repository's
 * checkout keeps its record there, so a hook running in the session's own tree finds none and the rule
 * stays silent rather than guessing; that is the same limit `epicrun.md` records for `--mark`.
 */
function read_last_report_sync(): number | undefined {
	const target = stamp_target_sync()

	return target === undefined ? undefined : read_last_report(target)
}

const run_progress_clock = {
	LIFE_PREFIX,
	PROGRESS_PREFIX,
	begin_life,
	end_life,
	is_life_ended,
	life_target_of,
	mark,
	parse_stamp,
	read_last_report,
	read_last_report_sync,
	stamp_target_of,
	stamp_target_sync,
}

export { run_progress_clock }
