import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

// joshuafolkken/kit#1091: `epicrun` asks `epic-busy.ts` whether a *repository* already has a child in
// flight, and the entry points a person types — `fullrun`, `halfrun`, `kickoff` — never reach that
// guard, because they do not go through `epic:next`. On 2026-08-30 two sessions therefore implemented
// two issues in one checkout at once, and the second was one command away from committing nine files
// onto the first one's branch.
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
// The spelling that removes a record this run did not write (joshuafolkken/kit#1799). **It is a
// separate spelling rather than the same one** because a stop message has to name something a person
// can type when a record really has been abandoned — and the one it named until now removed a *live*
// run's record just as readily, which is the incident this guard was written after, reached through
// the guard's own recovery instruction.
const FORCE_RELEASE_COMMAND = `${RELEASE_COMMAND} --force`
// The sentence `epic-busy.ts` prints for the same reason: a guard that cannot read its record has not
// established that the tree is free, and reporting it as free is the one failure that matters here.
const NOT_IDLE = 'that is not "nothing is running here"'

interface RunHold {
	issue: string
	taken_at: string
	pid: number
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

const run_hold_schema = z.object({
	issue: z.string(),
	taken_at: z.string(),
	pid: z.number(),
})

// `undefined` for anything that is not a well-formed record, so the caller decides what a broken one
// means. It means blocked, not free — see `classify`.
function parse_hold(raw: string): RunHold | undefined {
	try {
		const parsed = run_hold_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// **A `taken_at` that is not a date is stale, not current.** It passes the schema — it is a string —
// so reading it as current would leave the tree held with nothing left to expire it, which is the one
// state the expiry exists to make impossible. Fail-closed is still the answer for the *tree*: a stale
// record only lets a claim through once `run-hold-cli.ts`'s `blocking_message` has also found the
// tree clean.
function is_stale(hold: RunHold, now: Date): boolean {
	const taken = Date.parse(hold.taken_at)

	if (Number.isNaN(taken)) return true

	return now.getTime() - taken > HOLD_MAX_AGE_MS
}

// **A record that cannot be read is `unreadable`, never `free`.** Absent is free; present and
// unparseable is the state a guard must not fall open on, because the run that wrote it is the one
// whose uncommitted work would be trampled.
function classify(raw: string | undefined, now: Date): HoldRead {
	if (raw === undefined) return FREE_READ

	const hold = parse_hold(raw)

	if (hold === undefined) return UNREADABLE_READ

	return is_stale(hold, now) ? { kind: 'stale', hold } : { kind: 'held', hold }
}

function read_hold(target: string, now: Date = new Date()): HoldRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

function build_hold(issue: string, now: Date): RunHold {
	return { issue, taken_at: now.toISOString(), pid: process.pid }
}

function write_hold(target: string, issue: string, now: Date = new Date()): RunHold {
	const hold = build_hold(issue, now)

	stamp_file.write_stamp(target, hold)

	return hold
}

// The claim on a tree that read as free. **Exclusive rather than a plain write**: two sessions typing
// an entry point in the same second both read `free`, and a write would tell both of them they won —
// which is the incident this guard was written after, reproduced by the guard itself. `false` means
// the other one got there first.
function create_hold(target: string, issue: string, now: Date = new Date()): boolean {
	return stamp_file.create_stamp(target, build_hold(issue, now))
}

// **A tree with uncommitted work in it is never handed over, however old its record is.** No age can
// be chosen that covers a `halfrun` stop or a `needs-human-review` stop: those are held across a
// person's latency rather than a run's, and the thing that must not be trampled is sitting in the
// tree where anyone can see it. An unreadable status is dirty, for the reason every other unreadable
// state here blocks.
async function is_tree_dirty(): Promise<boolean> {
	try {
		const status = await git_command.status()

		return status.trim() !== ''
	} catch {
		return true
	}
}

function release_hold(target: string): void {
	stamp_file.remove_stamp(target)
}

// The pid is recorded for the person reading the stop message, never as the liveness test: the process
// that claims the tree is a short-lived `josh run:hold`, so it has exited by the time anything reads
// the record back. Age is what expires a record; `pnpm josh run:release --force` is what clears
// somebody else's early, and `pnpm josh run:release <N>` what the run that wrote it types.
function describe_holder(hold: RunHold): string {
	const holder = hold.issue === UNNUMBERED_ISSUE ? 'an unnumbered run' : `#${hold.issue}`

	return `${holder}, recorded ${hold.taken_at} (pid ${String(hold.pid)})`
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
	return `Replaced a stale run record held by ${describe_holder(hold)}: older than ${String(HOLD_MAX_AGE_HOURS)} hours, so the run that wrote it has ended without releasing it.`
}

function uncommitted_message(hold: RunHold): string {
	return `This working tree still has uncommitted changes, and its run record — held by ${describe_holder(hold)} — has expired. That is a run which stopped for a person rather than one that finished, so the tree is not free: commit or stash the work, or run \`${own_release_command(hold.issue)}\` once you are done with it, then ask again.`
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
	create_hold,
	describe_holder,
	foreign_release_message,
	forced_release_message,
	held_message,
	hold_path,
	is_own_hold,
	is_tree_dirty,
	own_release_command,
	parse_hold,
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

export type { HoldRead, RunHold }
export { run_hold }
