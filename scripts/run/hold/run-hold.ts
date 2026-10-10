import { git_command } from '#scripts/git/git-command'
import { session_cite } from '#scripts/issue/session-cite'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { stamp_record } from '#scripts/josh/stamp-record'
import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// One run at a time per working tree. The entry points a person types — `fullrun`, `halfrun`,
// `kickoff` — never reach `epic-busy.ts`'s guard, because they do not go through `epic:next`, so
// without this two sessions could implement two issues in one checkout and commit onto each other's
// branch.
//
// **The unit is the working tree, not the repository.** What these entries contend for is one branch,
// one index and one uncommitted diff; a linked work tree has its own three, so a second run there is
// legitimate and must not be stopped. Reusing `epic-busy.ts` here would stop it — that read answers
// about a repository, which is a different resource and a different question.
//
// The key is the work tree's own git directory: `git rev-parse --absolute-git-dir` answers `.git` in
// the main work tree and `.git/worktrees/<name>` in a linked one, so two work trees of one repository
// key differently while two commands in the same work tree key alike.

const HOLD_PREFIX = 'josh-run-hold-'
// The label a `new` entry point writes: the guard has to run *before* the issue is filed, or the
// stopped run leaves behind the very issue it should not have created.
const UNNUMBERED_ISSUE = 'new'
// Longer than any run — a measured `fullrun` is ten to fifty minutes — and short enough that a record
// abandoned by a crashed session is gone by the next working day. It is what keeps an abnormally
// ended run from holding the tree forever; a normally ended one is released by `josh followup`.
const HOLD_MAX_AGE_HOURS = 8
const MILLISECONDS_PER_HOUR = 3_600_000
const HOLD_MAX_AGE_MS = HOLD_MAX_AGE_HOURS * MILLISECONDS_PER_HOUR

const RELEASE_COMMAND = 'pnpm josh run:release'
// The spelling that removes a record this run did not write. **It is a separate spelling rather than
// the same one** because a stop message has to name something a person can type when a record really
// has been abandoned, without the plain release removing a *live* run's record just as readily.
const FORCE_RELEASE_COMMAND = `${RELEASE_COMMAND} --force`
// The sentence `epic-busy.ts` prints for the same reason: a guard that cannot read its record has not
// established that the tree is free, and reporting it as free is the one failure that matters here.
const NOT_IDLE = 'that is not "nothing is running here"'

interface RunHold {
	issue: string
	taken_at: string
	pid: number
	// Set only by `fullrun #N`'s entry (`run:entry` claims with `--fullrun`). The implementation cut
	// outside a lane resumes as `fullrun #N`, so a `halfrun` or an in-session `backlogrun` child — which
	// hold the tree just the same — must not be read as one. Optional and `| undefined` because a record
	// without this field is simply not a `fullrun`'s.
	is_fullrun?: boolean | undefined
	// Set only at a `halfrun`'s stop before commit (`run:hold <N> --halfrun-stop`): the positive record
	// that the run has *ended* over its verified diff, which is what lets `fullrun #N` adopt the hold. A
	// running `halfrun` or a `backlogrun` child never carries it.
	is_halfrun_stop?: boolean | undefined
	// Set only at a `prrun`'s stop before merge (`run:hold <N> --prrun-stop`): the commit the green pull
	// request stood on, so `fullrun #N` can tell an untouched branch — merge it — from one that moved
	// since and has to pass the gate and the review again.
	prrun_stop_head?: string | undefined
	// The agent session the claim ran under — `pid` is the short-lived `josh run:hold` itself, gone
	// before anything reads it back, so it can never say whether the run is still there. The pair with
	// its start time is the identity `process-identity.ts` defines. Optional for a record without these
	// fields, or by a claim made outside an agent session.
	owner_pid?: number | undefined
	owner_start?: string | undefined
}

type HoldRead =
	| { kind: 'free' }
	| { kind: 'held'; hold: RunHold }
	| { kind: 'stale'; hold: RunHold }
	| { kind: 'unreadable' }

const FREE_READ: HoldRead = { kind: 'free' }
const UNREADABLE_READ: HoldRead = { kind: 'unreadable' }

function hold_path(git_directory: string): string {
	return stamp_file.stamp_path(HOLD_PREFIX, git_directory)
}

// The first of the two paths git prints is this work tree's own; the second is the common directory
// every work tree of the repository shares, which is exactly what must not be the key.
async function worktree_directory(): Promise<string | undefined> {
	const directories = await git_command.git_directories()

	return directories[0]
}

// A linked work tree — a lane — reports its own git directory as the first path and the common
// directory every work tree of the repository shares as the second; the primary checkout reports one
// path for both. Comparing the two detects a lane without assuming the git directory is named `.git`:
// a `--separate-git-dir` clone or a bare repository defeats any `.git`-segment match.
async function is_linked_worktree(): Promise<boolean> {
	const directories = await git_command.git_directories()

	return directories[0] !== undefined && directories[0] !== directories[1]
}

const run_hold_schema = z.object({
	issue: z.string(),
	taken_at: z.string(),
	pid: z.number(),
	is_fullrun: z.boolean().optional(),
	is_halfrun_stop: z.boolean().optional(),
	prrun_stop_head: z.string().optional(),
	owner_pid: z.number().optional(),
	owner_start: z.string().optional(),
})

// `undefined` for anything that is not a well-formed record, so the caller decides what a broken one
// means. It means blocked, not free — see `classify`.
function parse_hold(raw: string): RunHold | undefined {
	return json_value.parse_with(raw, run_hold_schema)
}

// **A `taken_at` that is not a date is stale, not current.** It passes the schema — it is a string —
// so reading it as current would leave the tree held with nothing left to expire it, which is the one
// state the expiry exists to make impossible. Fail-closed is still the answer for the *tree*: a stale
// record only lets a claim through once `run-hold-cli.ts`'s `blocking_message` has also found the
// tree clean.
function is_expired(hold: RunHold, now: Date): boolean {
	return stamp_record.is_older_than(hold.taken_at, HOLD_MAX_AGE_MS, now)
}

// **A record whose session has ended is stale before its age says so**: the run
// that wrote it cannot release it any more, so waiting out the eight hours only stops the next run for
// nothing. Only a recorded session that is provably gone counts — no owner, or a live pid whose start
// cannot be read, leaves the age as the whole test. **A stop-marked record is exempt**: a `halfrun` or
// `prrun` stop is held across a person's latency on purpose, long after its session ends.
function is_owner_gone(hold: RunHold): boolean {
	const is_stop_mark = hold.is_halfrun_stop === true || hold.prrun_stop_head !== undefined

	if (is_stop_mark || hold.owner_pid === undefined) return false

	return process_identity.is_same_process(hold.owner_pid, hold.owner_start) === false
}

function is_stale(hold: RunHold, now: Date): boolean {
	return is_expired(hold, now) || is_owner_gone(hold)
}

// **A record that cannot be read is `unreadable`, never `free`.** Absent is free; present and
// unparseable is the state a guard must not fall open on, because the run that wrote it is the one
// whose uncommitted work would be trampled.
function classify(raw: string | undefined, now: Date): HoldRead {
	if (raw === undefined) return FREE_READ

	const hold = parse_hold(raw)

	if (hold === undefined) return UNREADABLE_READ

	return { kind: is_stale(hold, now) ? 'stale' : 'held', hold }
}

function read_hold(target: string, now: Date = new Date()): HoldRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

type Environment = Readonly<Record<string, string | undefined>>
type SessionOwner = Pick<RunHold, 'owner_pid' | 'owner_start'>

// The agent session's own process, which Claude Code exports to every command it runs. Absent or
// malformed is no owner at all, never a guess at an ancestor: a wrong owner read as gone frees a live
// run's tree, which is the one failure this guard exists to prevent.
function session_owner(environment: Environment = process.env): SessionOwner {
	const pid = Number(environment[agent_session_environment.AGENT_PID_KEY])

	if (!Number.isSafeInteger(pid) || pid <= 0) return {}

	return { owner_pid: pid, owner_start: process_identity.read_start(pid) }
}

function build_hold(issue: string, now: Date, is_fullrun?: boolean): RunHold {
	return { issue, taken_at: now.toISOString(), pid: process.pid, is_fullrun, ...session_owner() }
}

function write_hold(target: string, issue: string, now: Date = new Date()): RunHold {
	const hold = build_hold(issue, now)

	stamp_file.write_stamp(target, hold)

	return hold
}

// The claim on a tree that read as free. **Exclusive rather than a plain write**: two sessions typing
// an entry point in the same second both read `free`, and a write would tell both of them they won.
// `false` means the other one got there first.
function create_hold(
	target: string,
	issue: string,
	now: Date = new Date(),
	is_fullrun?: boolean,
): boolean {
	return stamp_file.create_stamp(target, build_hold(issue, now, is_fullrun))
}

// What a stopped run's record carries on top of the claim: the `halfrun` stop's flag, or the commit a
// `prrun` stop stood on.
type StopMarkFields = Pick<RunHold, 'is_halfrun_stop' | 'prrun_stop_head'>

const HALFRUN_STOP_FIELDS: StopMarkFields = { is_halfrun_stop: true }

// The claim a stop leaves behind: the same exclusive create, carrying the stop mark.
function create_stop_hold(
	target: string,
	issue: string,
	mark: StopMarkFields,
	now: Date = new Date(),
): boolean {
	return stamp_file.create_stamp(target, { ...build_hold(issue, now), ...mark })
}

function create_halfrun_stop_hold(target: string, issue: string, now: Date = new Date()): boolean {
	return create_stop_hold(target, issue, HALFRUN_STOP_FIELDS, now)
}

// **A tree with uncommitted work in it is never handed over, however old its record is.** No age can
// be chosen that covers a `halfrun` stop or a `needs-human-review` stop: those are held across a
// person's latency rather than a run's, and the thing that must not be trampled is sitting in the
// tree where anyone can see it. An unreadable status is dirty, for the reason every other unreadable
// state here blocks. `directory` asks the same of another work tree — a lane — instead of this one.
async function is_tree_dirty(directory?: string): Promise<boolean> {
	try {
		const status = await git_command.status(directory)

		return status.trim() !== ''
	} catch (error) {
		error_text.trace_swallowed('run_hold.is_tree_dirty', error)

		return true
	}
}

function release_hold(target: string): void {
	stamp_file.remove_stamp(target)
}

// The pid named is the session's where the record has one: the claiming `josh run:hold` has exited by
// the time anything reads the record back, so its own pid tells a person nothing. Age or an ended
// session is what expires a record; `pnpm josh run:release --force` is what clears somebody else's
// early, and `pnpm josh run:release <N>` what the run that wrote it types.
function describe_holder(hold: RunHold): string {
	const holder =
		hold.issue === UNNUMBERED_ISSUE ? 'an unnumbered run' : session_cite.issue(hold.issue)

	return `${holder}, recorded ${hold.taken_at} (pid ${String(hold.owner_pid ?? hold.pid)})`
}

// The command the run that *wrote* a record types to remove it — the claim's own spelling, mirrored,
// so that releasing names the run exactly as claiming did.
function own_release_command(issue: string): string {
	return issue === UNNUMBERED_ISSUE ? RELEASE_COMMAND : `${RELEASE_COMMAND} ${issue}`
}

// The whole of the ownership test, and it is the issue rather than the pid: the process that claims a
// tree is a short-lived `josh run:hold` that has exited before anything reads the record back, while
// the issue is what identifies a run across every command it issues. `run-carry.ts` compares a
// recorded owner against a declared one for the same reason; what differs is only who the owner is.
function is_own_hold(hold: RunHold, claimant: string): boolean {
	return hold.issue === claimant
}

// **A claim for the issue the record already names is the same run asking again** — a second
// `run:entry` in one session must not answer `busy` to its own hold. The unnumbered `new` claim names
// no run, so two of them are still two runs.
function is_reentry(hold: RunHold, claimant: string): boolean {
	return claimant !== UNNUMBERED_ISSUE && is_own_hold(hold, claimant)
}

function held_message(hold: RunHold): string {
	return `This working tree is already held by ${describe_holder(hold)}. One run at a time per working tree: a second run here commits its files onto the other run's branch. If that record is stale, run \`${FORCE_RELEASE_COMMAND}\` in this working tree — it removes a record this run did not write, so be sure the run that did has ended — and ask again.`
}

// **A release asked by anything but the record's own run removes nothing.** "Stale" is a judgement
// made from outside the run that wrote the record, and the one place it is made is a person reading a
// `busy` stop — so the refusal names both ways forward rather than only refusing.
function foreign_release_message(hold: RunHold): string {
	return `This working tree is held by ${describe_holder(hold)}, and this release did not claim it — nothing was removed. Release it as that run with \`${own_release_command(hold.issue)}\`, or, once you are sure it has ended, remove the record with \`${FORCE_RELEASE_COMMAND}\`.`
}

function forced_release_message(hold: RunHold): string {
	return `Forced: removed the run record held by ${describe_holder(hold)}.`
}

function unreadable_message(): string {
	return `This working tree's run record could not be read — ${NOT_IDLE}. Run \`${FORCE_RELEASE_COMMAND}\` in this working tree to clear it, then ask again.`
}

function stale_message(hold: RunHold): string {
	const why = is_owner_gone(hold)
		? 'the session that wrote it has ended'
		: `older than ${String(HOLD_MAX_AGE_HOURS)} hours`

	return `Replaced a stale run record held by ${describe_holder(hold)}: ${why}, so the run that wrote it has ended without releasing it.`
}

function uncommitted_message(hold: RunHold): string {
	return `This working tree still has uncommitted changes, and its run record — held by ${describe_holder(hold)} — has expired or outlived its session. That is a run which stopped for a person rather than one that finished, so the tree is not free: commit or stash the work, or run \`${own_release_command(hold.issue)}\` once you are done with it, then ask again.`
}

// The exclusive claim lost: another process wrote the record between this one's read and its write.
// Re-reading names the winner where it still holds; where it does not, the record is one this account
// cannot read — a file another user owns on a shared temp directory — and the answer is still `busy`,
// because this run did not get the tree. **The path is named** so the person is not sent round a loop
// of "ask again" that can never come out differently: `run:release` cannot remove a file it does not
// own either.
function race_message(read: HoldRead, target: string): string {
	if (read.kind === 'held') return held_message(read.hold)

	return `A record already exists at ${target} and this run did not write it — ${NOT_IDLE}. Either another run claimed the tree at the same moment, or the record belongs to another account. Run \`${FORCE_RELEASE_COMMAND}\`, and remove that file by hand if it is still there.`
}

function unknown_message(): string {
	return `Could not read this working tree's git directory — ${NOT_IDLE}. Run this from inside the checkout the run will edit.`
}

const run_hold = {
	FORCE_RELEASE_COMMAND,
	HOLD_MAX_AGE_HOURS,
	HOLD_MAX_AGE_MS,
	RELEASE_COMMAND,
	UNNUMBERED_ISSUE,
	classify,
	create_halfrun_stop_hold,
	create_stop_hold,
	HALFRUN_STOP_FIELDS,
	create_hold,
	foreign_release_message,
	forced_release_message,
	held_message,
	hold_path,
	is_linked_worktree,
	is_own_hold,
	is_reentry,
	is_tree_dirty,
	own_release_command,
	race_message,
	read_hold,
	release_hold,
	stale_message,
	uncommitted_message,
	unknown_message,
	unreadable_message,
	worktree_directory,
	write_hold,
}

export type { HoldRead, RunHold, StopMarkFields }
export { run_hold }
