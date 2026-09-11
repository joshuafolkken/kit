import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { git_command } from '#scripts/git/git-command'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { run_invocation } from './run-invocation'

// joshuafolkken/kit#1714: a `backlogrun` declares a budget — `--max`, `--idle` and the 8-hour
// whole-run bound — and then loses all of it at the session cut, because the cut ends the session and
// the next one starts from nothing. The decision recorded on that issue is that **the cut is an
// execution detail of the same authorization**, so the budget has to survive it. Nothing in this
// repository persisted a run across sessions before: `epicrun.md` → "What carries over" reads its
// state back off GitHub, and there is no epic to read it off when the run began from the backlog.
//
// **The unit is the repository, not the working tree.** `run-hold.ts` keys on the work tree's own git
// directory because what it guards is one branch, one index and one diff. What this record guards is
// one *invocation's* budget, and that invocation opens lanes — each a work tree of its own — so the
// key is the common git directory, which every lane of one repository shares.
//
// **The 8-hour bound is the record's expiry.** Held as an age rather than as prose, the bound is
// decided the same way `backlog:budget` decides the other two: the command answers, and the run
// obeys. A run that reads `expired` has spent the bound whatever any count says.
//
// **Whose record it is, is decided by liveness and by a declared hand-off — never by the invocation
// text** (joshuafolkken/kit#1722). Comparing the `invocation` string was the first answer, and it
// walks straight through the case that happens most: a run dies, a person retypes the same command,
// and the string matches, so the fresh session inherits the dead run's counters and a `started_at`
// hours old. Two things replace it. The record names the **long-lived process spending the budget**
// — `owner_pid` with the start time that tells a reused pid apart, the identity pair
// `process-identity.ts` already keeps for every other record — so a second parent asking for a
// record whose owner is still running is refused rather than told it may count into it. And a
// **session cut declares itself**: `--cut` marks the record as handed off, which a crash never
// reaches, so only a cut the run itself took is carried without anyone deciding. Everything else is
// an explicit carry-or-discard: `--resume` adopts the standing record, `--end` discards it.

const CARRY_PREFIX = 'josh-run-carry-'
const REPOSITORY_DIRECTORY_INDEX = 1
// **The whole-run bound is `backlog-budget.ts`'s, imported rather than restated.** `epicrun.md` →
// "Waiting, and never waiting forever" states the figure and that module applies it; a second copy
// here would drift, and the drift is silent in exactly the direction that matters — raised there and
// still 8 here, this record answers `expired`, `--begin` replaces it, and the budget restarts at
// zero, which is the defect joshuafolkken/kit#1714 exists to prevent.
const CARRY_MAX_AGE_HOURS = backlog_budget.WHOLE_RUN_BUDGET_HOURS
const CARRY_MAX_AGE_MS = backlog_budget.WHOLE_RUN_BUDGET_MS
const NO_INCREMENT = 0

const END_COMMAND = 'pnpm josh run:carry --end'
const RESUME_COMMAND = 'pnpm josh run:carry --resume'
const READ_COMMAND = 'pnpm josh run:carry --json'
// The shell variable that names the parent loop's own long-lived process, quoted so the reader can
// paste the printed command as it stands.
const OWNER_ARGUMENT = '--owner "$PPID"'

interface RunCarry {
	// The invocation as the person typed it, so a resumed session runs the same command rather than
	// one it inferred. `CLAUDE.md` → "Explicit invocation required" forbids inferring; naming the
	// invocation is what leaves nothing to infer. **It is not the ownership test** — that is
	// `classify_claim` below, for the reason the header gives.
	invocation: string
	started_at: string
	merged: number
	filed: number
	cuts: number
	// The process spending the budget, as the caller declared it with `--owner`. `run-hold.ts` records
	// a pid it explicitly does not read back, because the process that claims a work tree is the
	// short-lived `josh run:hold` itself; here the owner is the parent loop's own session, which
	// outlives every command it issues, so the pid is what a second parent is refused against. Both
	// halves are optional: a record written before this field existed, or by a caller that named no
	// owner, is simply not provably live.
	//
	// **`| undefined` explicitly, rather than the bare optional `exactOptionalPropertyTypes` prefers.**
	// The record round-trips through `JSON.stringify`, which drops a property whose value is
	// `undefined`, so absent and explicitly-undefined are the *same* record on disk — a type that told
	// them apart would be asserting a distinction nothing here can observe.
	owner_pid?: number | undefined
	owner_start?: string | undefined
	// Set by `--cut`, and by nothing else. A crash never reaches `--cut`, which is what makes a
	// declared cut the only standing record carried without a person deciding.
	is_handed_off?: boolean | undefined
	// The issues this invocation has already finished, as `--done <N>` recorded them
	// (joshuafolkken/kit#1774). **It exists because a `queue`'s invocation must not shrink.** The
	// obvious way to resume `queue #1762 #1749 #1759` after #1762 merged is to begin again as
	// `queue #1749 #1759` — and `classify_claim` compares the invocation character for character, so
	// that answers `mismatch` and the run stops. Pinning the string to the opening list and keeping the
	// progress here leaves that comparison, and joshuafolkken/kit#1722's single-writer guarantee with
	// it, exactly as it was. `merged` cannot serve: it is a count of merges rather than a set of
	// issues, so a child that ended without one — `already-done`, or a park — would shift every
	// remaining position by one.
	done?: ReadonlyArray<number> | undefined
}

// The identity of a process, as `process-identity.ts` keeps it: the pid plus an opaque start-time
// token, so a reissued pid is never mistaken for the process that wrote the record.
interface CarryOwner {
	pid?: number | undefined
	start?: string | undefined
}

// **`resume` is the only one of the four that establishes anything.** The other three are refusals,
// and they are three rather than one because what the reader has to do differs: wait, retype the
// invocation, or decide between carrying and discarding.
type CarryClaim = 'resume' | 'busy' | 'mismatch' | 'standing'

interface CarryClaimRequest {
	invocation: string
	owner: CarryOwner
	// `--resume` rather than `--begin`: the caller has decided to adopt a standing record, which is
	// the carry half of the answer `standing` asks for.
	is_adoption: boolean
}

// Every counter is an increment rather than a total: a run that sent a total would be sending an
// arithmetic it had done in its head, which is the one-shot judgement joshuafolkken/kit#1460
// measured a run walking past.
interface CarryChange {
	merged?: number
	filed?: number
	cuts?: number
	// One issue number to add to `done`, not a count. It is the one field of a change that names a
	// thing rather than an amount, because what a resumed queue needs is *which* issues are finished.
	done?: number
}

type CarryRead =
	| { kind: 'none' }
	| { kind: 'carried'; carry: RunCarry }
	| { kind: 'expired'; carry: RunCarry }
	| { kind: 'unreadable' }

const NONE_READ: CarryRead = { kind: 'none' }
const UNREADABLE_READ: CarryRead = { kind: 'unreadable' }
const NO_OWNER: CarryOwner = {}

const run_carry_schema = z.object({
	invocation: z.string(),
	started_at: z.string(),
	merged: z.number(),
	filed: z.number(),
	cuts: z.number(),
	// Optional, so a record written by the previous shape still parses. Read as "no owner declared",
	// which is the not-provably-live answer rather than a live one.
	owner_pid: z.number().optional(),
	owner_start: z.string().optional(),
	is_handed_off: z.boolean().optional(),
	done: z.array(z.number()).optional(),
})

function carry_path(git_directory: string): string {
	return stamp_file.stamp_path(CARRY_PREFIX, git_directory)
}

// The common git directory: `.git` in the main work tree and the same `.git` from inside a lane, so
// one invocation keys alike wherever its commands run.
async function repository_directory(): Promise<string | undefined> {
	const directories = await git_command.git_directories()

	return directories[REPOSITORY_DIRECTORY_INDEX]
}

function parse_carry(raw: string): RunCarry | undefined {
	try {
		const parsed = run_carry_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// A `started_at` that is not a date is read as expired rather than as current, for the reason
// `run-hold.ts` reads an unparsable `taken_at` that way: a record nothing can ever expire is the one
// state the bound exists to make impossible.
function is_expired(carry: RunCarry, now: Date): boolean {
	const started = Date.parse(carry.started_at)

	if (Number.isNaN(started)) return true

	return now.getTime() - started > CARRY_MAX_AGE_MS
}

function classify(raw: string | undefined, now: Date): CarryRead {
	if (raw === undefined) return NONE_READ

	const carry = parse_carry(raw)

	if (carry === undefined) return UNREADABLE_READ

	return is_expired(carry, now) ? { kind: 'expired', carry } : { kind: 'carried', carry }
}

function read_carry(target: string, now: Date = new Date()): CarryRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

// The identity to record for a pid the caller declared. `read_start` is what makes the pair an
// identity rather than a number: a pid the operating system reissues to something else has a
// different start time, so the record stops matching the moment its owner is gone.
function owner_of(pid: number): CarryOwner {
	return { pid, start: process_identity.read_start(pid) }
}

function fresh_carry(invocation: string, owner: CarryOwner, now: Date): RunCarry {
	return {
		invocation,
		started_at: now.toISOString(),
		merged: NO_INCREMENT,
		filed: NO_INCREMENT,
		cuts: NO_INCREMENT,
		owner_pid: owner.pid,
		owner_start: owner.start,
	}
}

// **Create-exclusively, exactly as `run-hold.ts` claims a work tree.** Two sessions that both read
// `none` in the same instant would both be told they had begun a run, and the second one's write
// would erase the first one's ownership — so the write is the ownership assertion and `undefined` is
// losing that race, never an error.
function begin_carry(
	target: string,
	invocation: string,
	owner: CarryOwner = NO_OWNER,
	now: Date = new Date(),
): RunCarry | undefined {
	const carry = fresh_carry(invocation, owner, now)

	return stamp_file.create_stamp(target, carry) ? carry : undefined
}

// Replacing a record whose bound is spent. It removes and then creates exclusively rather than
// writing over the old bytes, for the reason `run-hold.ts` replaces a stale hold the same way: a
// plain write would put the race back one branch over.
function replace_carry(
	target: string,
	invocation: string,
	owner: CarryOwner = NO_OWNER,
	now: Date = new Date(),
): RunCarry | undefined {
	stamp_file.remove_stamp(target)

	return begin_carry(target, invocation, owner, now)
}

// Taking over a standing record: the counters and `started_at` are the run's and stay, the owner
// becomes this session, and the hand-off is spent. **`cuts` is not incremented here** — `--cut`
// counts the cut, and a record adopted after a crash crossed no cut at all.
//
// **It creates exclusively, like every other claim here.** Two sessions reading one handed-off record
// would both classify `resume`, and a plain write would tell both of them they had taken it over;
// `undefined` is losing that race. The write window itself is `stamp-file.ts`'s and is unchanged —
// what this closes is the silent second winner.
function adopt_carry(
	target: string,
	carry: RunCarry,
	owner: CarryOwner = NO_OWNER,
): RunCarry | undefined {
	const { invocation, started_at, merged, filed, cuts, done } = carry
	// The recorded fields are named rather than spread from `carry`, so the previous owner cannot
	// survive an adoption by a caller that declared none. **`done` is carried across**: the whole point
	// of the resumption is that the successor does not re-run what the cut session finished.
	const next: RunCarry = {
		invocation,
		started_at,
		merged,
		filed,
		cuts,
		done,
		owner_pid: owner.pid,
		owner_start: owner.start,
		is_handed_off: false,
	}

	stamp_file.remove_stamp(target)

	return stamp_file.create_stamp(target, next) ? next : undefined
}

// Recording the same issue twice leaves the record alone, so a `--done` reissued after a retry — or by
// a resumed session repeating the merge it was cut on — cannot list an issue twice and cannot shorten
// `remaining` by something already taken out of it.
function next_done(carry: RunCarry, done: number | undefined): ReadonlyArray<number> | undefined {
	if (done === undefined) return carry.done

	const current = carry.done ?? []

	return current.includes(done) ? current : [...current, done]
}

function apply_change(target: string, carry: RunCarry, change: CarryChange): RunCarry {
	const cuts = change.cuts ?? NO_INCREMENT
	const next: RunCarry = {
		...carry,
		merged: carry.merged + (change.merged ?? NO_INCREMENT),
		filed: carry.filed + (change.filed ?? NO_INCREMENT),
		cuts: carry.cuts + cuts,
		done: next_done(carry, change.done),
		// A cut declares the hand-off; any other count is the run carrying on, which spends it.
		is_handed_off: cuts > NO_INCREMENT,
	}

	stamp_file.write_stamp(target, next)

	return next
}

// `=== true` rather than truthiness: `is_same_process` answers `undefined` where this platform cannot
// tell, and where nobody declared an owner. Both resolve to *not provably live*, which routes to
// `standing` — a refusal that asks for a decision — instead of to `busy`, which would claim a fact
// nothing established.
function is_owner_live(carry: RunCarry): boolean {
	return process_identity.is_same_process(carry.owner_pid, carry.owner_start) === true
}

function is_owned_by(carry: RunCarry, owner: CarryOwner): boolean {
	return carry.owner_pid === owner.pid && carry.owner_start === owner.start
}

// The one case that is not this caller's to touch: the record's owner is still running and it is
// somebody else. **The invocation text is not consulted** — a live owner holds the budget whatever
// either command line says, which is the whole of joshuafolkken/kit#1722.
function is_foreign_live_owner(carry: RunCarry, owner: CarryOwner): boolean {
	return is_owner_live(carry) && !is_owned_by(carry, owner)
}

function is_handed_off_to(carry: RunCarry, invocation: string): boolean {
	return carry.is_handed_off === true && carry.invocation === invocation
}

// **The order is the rule, and liveness comes first.** A hand-off read ahead of it would let a second
// parent naming the same invocation take over a record whose owner is still running — the string
// comparison joshuafolkken/kit#1722 removes, surviving on one path, since a `--cut` is issued while
// the cutting process is still alive. A record's *own* owner is not foreign, so the session that
// declared the cut still resumes when the cut kept its process. Then: a declared hand-off is carried,
// a different invocation is named as such, and what is left — the same command retyped over a record
// no cut handed off — is `standing`, which is the one answer that used to read `resumed`.
function classify_claim(carry: RunCarry, request: CarryClaimRequest): CarryClaim {
	if (is_foreign_live_owner(carry, request.owner)) return 'busy'

	if (is_handed_off_to(carry, request.invocation)) return 'resume'

	if (carry.invocation !== request.invocation) return 'mismatch'

	return request.is_adoption ? 'resume' : 'standing'
}

function end_carry(target: string): void {
	stamp_file.remove_stamp(target)
}

// **What the resumed session has to be told, computed rather than stored.** A stored remainder would
// be a second copy of a subtraction the record already determines, free to disagree with it; computed
// here, `--json` answers the successor's one question — which issues are left, in the order they were
// declared — so nothing downstream has to subtract two lists by hand. Anything that is not a `queue`
// answers `undefined`, which `JSON.stringify` drops: a `backlogrun` record is unchanged by this.
function remaining_of(carry: RunCarry | undefined): ReadonlyArray<number> | undefined {
	if (carry === undefined) return undefined

	const declared = run_invocation.issue_numbers(carry.invocation)

	if (declared === undefined) return undefined

	const done = carry.done ?? []

	return declared.filter((issue) => !done.includes(issue))
}

// The finished issues are named rather than counted, because the reader of a `busy` or `standing`
// message about a queue has to know which ones are already merged before deciding anything.
function done_note(carry: RunCarry): string {
	const done = carry.done ?? []

	return done.length === 0 ? '' : `, issues ${done.join(', ')} done`
}

function describe_carry(carry: RunCarry): string {
	return `${carry.invocation} started ${carry.started_at}; ${String(carry.merged)} merged, ${String(carry.filed)} filed, ${String(carry.cuts)} cut(s) crossed${done_note(carry)}`
}

function expired_message(carry: RunCarry): string {
	return `The ${String(CARRY_MAX_AGE_HOURS)}-hour whole-run bound is spent: ${describe_carry(carry)}. Clear it with \`${END_COMMAND}\`.`
}

// A record left standing by a run that never reached `--end`. Naming both invocations is the point:
// the reader has to see that the budget in the way belongs to something else before deciding whether
// that run is over.
function mismatch_message(carry: RunCarry, invocation: string): string {
	return `A different invocation is carried here — ${describe_carry(carry)}. This one is \`${invocation}\`. End the standing record with \`${END_COMMAND}\` once you know its run is over, then begin again.`
}

// The owner process is still running, so this budget is being spent by something else right now. The
// message says so rather than offering `--resume`: adopting a live run's record is the two-parents
// case, not a recovery.
function busy_message(carry: RunCarry): string {
	return `A live run holds this budget — ${describe_carry(carry)}, owner pid ${String(carry.owner_pid)} still running. Nothing was established. Wait for that run, or end its record with \`${END_COMMAND}\` once you know it is over.`
}

// The record's owner is gone and no cut handed it off — the crashed run, and the same command
// retyped over it. Both ways out are named, because which one is right is the reader's to say and
// not this command's to guess.
// **`--owner "$PPID"` is part of the command it prints, not an optional extra.** An adoption made
// without it leaves the record declaring no owner, and from then on every second parent reads it as
// not provably live and is answered `standing` rather than `busy` — the ownership defense degrading
// silently through the very message that recommends the command.
function standing_message(carry: RunCarry): string {
	return `A run record is standing here that no cut handed off — ${describe_carry(carry)}. Nothing was established. Carry that budget with \`${RESUME_COMMAND} "${carry.invocation}" ${OWNER_ARGUMENT}\`, or discard it with \`${END_COMMAND}\` and begin again.`
}

// The exclusive create lost: another process established the record between this one's read and its
// write. That is `busy` by definition, and it is said without re-reading a record this caller does
// not own.
function lost_message(): string {
	return `Another process established a run record here first, so nothing was established. Read it with \`${READ_COMMAND}\`.`
}

// A `--resume` against a repository with nothing carried. The reader asked to adopt a budget that is
// not there, so beginning one silently would be this command inventing the answer it exists to give.
function nothing_to_resume_message(): string {
	return `Nothing is carried here, so there is no budget to resume. Begin one with \`pnpm josh run:carry --begin "<invocation>"\`.`
}

function unreadable_message(): string {
	return `A run record is here but could not be read; clear it with \`${END_COMMAND}\` once you know no run is using it.`
}

function unknown_message(): string {
	return 'This repository’s git directory could not be read, so no run record was established.'
}

const run_carry = {
	CARRY_MAX_AGE_HOURS,
	CARRY_MAX_AGE_MS,
	END_COMMAND,
	NO_OWNER,
	RESUME_COMMAND,
	adopt_carry,
	apply_change,
	begin_carry,
	busy_message,
	carry_path,
	classify,
	classify_claim,
	describe_carry,
	end_carry,
	expired_message,
	mismatch_message,
	fresh_carry,
	is_expired,
	is_foreign_live_owner,
	is_owner_live,
	lost_message,
	nothing_to_resume_message,
	owner_of,
	parse_carry,
	read_carry,
	remaining_of,
	replace_carry,
	repository_directory,
	standing_message,
	unknown_message,
	unreadable_message,
}

export type { CarryChange, CarryClaim, CarryClaimRequest, CarryOwner, CarryRead, RunCarry }
export { run_carry }
