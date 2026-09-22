import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { git_command } from '#scripts/git/git-command'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { run_carry_streak } from './run-carry-streak'
import { run_invocation } from './run-invocation'

// joshuafolkken/kit#1714: a `backlogrun` declares a budget — `--max`, `--idle` and the 8-hour
// whole-run bound — and then loses all of it at the session cut, because the cut ends the session and
// the next one starts from nothing. The decision recorded on that issue is that **the cut is an
// execution detail of the same authorization**, so the budget has to survive it. Nothing in this
// repository persisted a run across sessions before: `backlogrun-progress.md` → "What carries over" reads its
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
// **The whole-run bound is `backlog-budget.ts`'s, imported rather than restated.** `backlogrun.md` →
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
	// The consecutive-failure streak (joshuafolkken/kit#2024). It is the count the stopped-unit guard
	// leans on to notice the environment is at fault, and it lived only in the epic progress comment
	// before this — the second place a counter was kept. Folded into the record so the record is the
	// single source and the comment is generated from it. **A merge resets it to zero**: three failures
	// in a row stop the run, and a child that merged in between breaks the streak. Read through
	// `apply_change`, never bumped from outside, so the reset stays with the increment.
	failures: number
	// The consecutive-API-outage streak (joshuafolkken/kit#2240). It is kept apart from `failures`
	// because a child that could not reach the API is not a child that failed: an outage is not counted
	// against the consecutive-failure guard, and this streak is its own environment-broken guard — a run
	// of outages stops the run rather than re-dispatching into a dead API forever. **A merge or a genuine
	// child failure resets it**, because both prove the API was reachable; only a further outage adds to
	// it. Defaulted to zero so a record written before this field existed still parses.
	outages: number
	// When the last *counted* outage was booked, so a burst of outages from one network event folds into
	// a single streak step rather than several (joshuafolkken/kit#2317). Read by `run-carry-streak.ts`
	// against its fold window; set only when an outage counts, cleared when the API proves reachable.
	// Optional and `| undefined` for the same disk round-trip reason the owner fields carry.
	last_outage_at?: string | undefined
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
	// (joshuafolkken/kit#1774; folded into `backlogrun` by joshuafolkken/kit#1984). **It exists because
	// a named-issue invocation must not shrink.** The obvious way to resume
	// `backlogrun #1762 #1749 #1759` after #1762 merged is to begin again as `backlogrun #1749 #1759` —
	// and `classify_claim` compares the invocation character for character, so that answers `mismatch`
	// and the run stops. Pinning the string to the opening list and keeping the progress here leaves
	// that comparison, and joshuafolkken/kit#1722's single-writer guarantee with it, exactly as it was.
	// `merged` cannot serve: it is a count of merges rather than a set of issues, so a child that ended
	// without one — `already-done`, or a park — would shift every remaining position by one.
	done?: ReadonlyArray<number> | undefined
	// Whether this invocation's end-of-run retrospective has already run (joshuafolkken/kit#2328). It
	// is the state the two run-ending points hold so `run:step` prints the retrospective exactly once:
	// the record is one per invocation and survives every session cut, so a run cannot repeat it after a
	// resume, and `--end` removes the record so it cannot leak into the next invocation. Set by
	// `--retrospective`, and carried across a hand-off like `done`. Optional and `| undefined` for the
	// same disk round-trip reason the owner fields carry.
	retrospective?: boolean | undefined
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
	// One failed child to add to the streak (joshuafolkken/kit#2024). It is never sent in the same
	// change as `merged` — a child either merged or it did not — and a change that carries `merged`
	// resets the streak regardless of this field.
	failures?: number
	// One API-outage child to add to the outage streak (joshuafolkken/kit#2240). Never sent with
	// `merged` or `failures` — a child either merged, failed, or could not reach the API — and both of
	// those reset this streak.
	outages?: number
	// One issue number to add to `done`, not a count. It is the one field of a change that names a
	// thing rather than an amount, because what a resumed named-issue run needs is *which* issues are
	// finished.
	done?: number
	// Marks the end-of-run retrospective as run (joshuafolkken/kit#2328). It only ever sets the flag,
	// never clears it: a retrospective that has run stays run for the rest of the invocation.
	retrospective?: boolean
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
	// Defaulted, so a record written before this field existed parses with a zero streak rather than
	// failing to read — the same backward-compatibility the optional owner fields below carry.
	failures: z.number().default(0),
	// Defaulted for the same backward-compatibility as `failures` (joshuafolkken/kit#2240).
	outages: z.number().default(0),
	// Optional, so a record written before the outage fold existed still parses (joshuafolkken/kit#2317).
	last_outage_at: z.string().optional(),
	// Optional, so a record written by the previous shape still parses. Read as "no owner declared",
	// which is the not-provably-live answer rather than a live one.
	owner_pid: z.number().optional(),
	owner_start: z.string().optional(),
	is_handed_off: z.boolean().optional(),
	done: z.array(z.number()).optional(),
	// Optional, so a record written before the retrospective existed still parses (joshuafolkken/kit#2328).
	retrospective: z.boolean().optional(),
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

	return { kind: is_expired(carry, now) ? 'expired' : 'carried', carry }
}

function read_carry(target: string, now: Date = new Date()): CarryRead {
	return classify(stamp_file.read_stamp_text(target), now)
}

// The identity to record for a pid the caller declared. `read_start` is what makes the pair an
// identity rather than a number; injected in tests so the sandbox branch is exercised without
// changing the machine's process capabilities.
function owner_of(
	pid: number,
	read: (owner_pid: number) => string | undefined = process_identity.read_start,
): CarryOwner {
	return { pid, start: read(pid) }
}

function fresh_carry(invocation: string, owner: CarryOwner, now: Date): RunCarry {
	return {
		invocation,
		started_at: now.toISOString(),
		merged: NO_INCREMENT,
		filed: NO_INCREMENT,
		cuts: NO_INCREMENT,
		failures: NO_INCREMENT,
		outages: NO_INCREMENT,
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
	// The run's own fields carry across untouched — the counters, the outage fold timestamp
	// (joshuafolkken/kit#2317), `done` so the successor does not re-run what the cut session finished,
	// and `retrospective` so a run resumed after a cut does not repeat its retrospective. Only the three
	// ownership fields are overridden: the new owner replaces the old — a caller that declared none
	// writes `undefined`, so the previous owner cannot survive — and the declared hand-off is spent.
	const next: RunCarry = {
		...carry,
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

// Sticky: a retrospective that has run stays run, so a later count never clears the flag. Held apart
// from `apply_change` so its one branch stays out of that function's complexity.
function next_retrospective(carry: RunCarry, change: CarryChange): boolean | undefined {
	return change.retrospective === true || carry.retrospective
}

// The streak arithmetic — the two consecutive counters and the outage fold — is `run-carry-streak.ts`'s
// (joshuafolkken/kit#2317), so the reset-with-the-increment rule lives with it rather than in a caller
// that could forget it. `now` is threaded in so the fold window is measured against the record and
// injectable in tests; it defaults to the wall clock like the other reads here.
function apply_change(
	target: string,
	carry: RunCarry,
	change: CarryChange,
	now: Date = new Date(),
): RunCarry {
	const cuts = change.cuts ?? NO_INCREMENT
	const streak = run_carry_streak.next_state(carry, change, now)
	const next: RunCarry = {
		...carry,
		merged: carry.merged + (change.merged ?? NO_INCREMENT),
		filed: carry.filed + (change.filed ?? NO_INCREMENT),
		cuts: carry.cuts + cuts,
		failures: streak.failures,
		outages: streak.outages,
		last_outage_at: streak.last_outage_at,
		done: next_done(carry, change.done),
		retrospective: next_retrospective(carry, change),
		// A cut declares the hand-off; any other count is the run carrying on, which spends it.
		is_handed_off: cuts > NO_INCREMENT,
	}

	stamp_file.write_stamp(target, next)

	return next
}

// A live pid with no readable start token is conservatively held rather than replaced. The command
// cannot prove its generation inside that sandbox, but a false `busy` stops for a person while a
// false `standing` can put two parents on one budget. A record with no pid still resolves false.
function is_owner_live(carry: RunCarry): boolean {
	return process_identity.is_same_process(carry.owner_pid, carry.owner_start) !== false
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

// **The order is the rule, and a declared hand-off comes first** (joshuafolkken/kit#1935). Liveness
// used to be checked ahead of it, on the assumption that the cutting process dies right after `--cut`,
// so a live owner over a handed-off record could only be a second parent racing in. That assumption
// fails twice: a `backlogrun` cut from an interactive session never ends its process, and a lane child
// cut before the gate can be woken again by a background task's notification — and in both the live
// owner *is* the session that cut, so liveness-first answered `busy` forever and no successor could
// ever take over. Reading the hand-off first hands the record to exactly one successor regardless of
// whether the cutting process is still alive, and it is safe because a hand-off requires the explicit
// `--cut` flag a crash never reaches, so the cross-run inheritance joshuafolkken/kit#1722 removes still
// cannot arise: a retyped command over a crashed record has no hand-off to match. Uniqueness is
// `adopt_carry`'s — it spends `is_handed_off` and rewrites the owner, so the *second* would-be
// successor reads a record no longer handed off, owned by a live foreign process, and is answered
// `busy`. Then: a live foreign owner over a record no cut handed off is refused, a different invocation
// is named as such, and what is left — the same command retyped over a record no cut handed off — is
// `standing`, which is the one answer that used to read `resumed`.
function classify_claim(carry: RunCarry, request: CarryClaimRequest): CarryClaim {
	if (is_handed_off_to(carry, request.invocation)) return 'resume'

	if (is_foreign_live_owner(carry, request.owner)) return 'busy'

	if (carry.invocation !== request.invocation) return 'mismatch'

	return request.is_adoption ? 'resume' : 'standing'
}

// **A budget count is refused unless this session is the record's live owner**
// (joshuafolkken/kit#1935). Two records reach here that are not this session's to advance: one the
// cutting session handed off but no successor has adopted yet — `is_handed_off` still set, so a stray
// count from the cutting session would spend the hand-off back to `false` and strand the successor —
// and one a successor has already adopted, now owned by a live foreign process, whose budget is that
// successor's. Both keep joshuafolkken/kit#1722's single writer: only the owner advances the counters.
// The hand-off is read first because a cut does not change the owner, so the cutting session is still
// its *own* owner between the cut and the adoption, and the foreign check would let it through.
function is_count_refused(carry: RunCarry, owner: CarryOwner): boolean {
	return carry.is_handed_off === true || is_foreign_live_owner(carry, owner)
}

function end_carry(target: string): void {
	stamp_file.remove_stamp(target)
}

// Whether the read record marks its retrospective as already run (joshuafolkken/kit#2328). A read with
// no record — `none` or `unreadable` — is not a run whose retrospective has run, so it answers `false`;
// `run:step` reads it to decide whether the stop position still owes a retrospective.
function retrospective_done_of(read: CarryRead): boolean {
	if (read.kind !== 'carried' && read.kind !== 'expired') return false

	return read.carry.retrospective === true
}

// **What the resumed session has to be told, computed rather than stored.** A stored remainder would
// be a second copy of a subtraction the record already determines, free to disagree with it; computed
// here, `--json` answers the successor's one question — which issues are left, in the order they were
// declared — so nothing downstream has to subtract two lists by hand. An invocation that named no
// issues answers `undefined`, which `JSON.stringify` drops: a budget-only `backlogrun` record is
// unchanged by this.
function remaining_of(carry: RunCarry | undefined): ReadonlyArray<number> | undefined {
	if (carry === undefined) return undefined

	const declared = run_invocation.issue_numbers(carry.invocation)

	if (declared === undefined) return undefined

	const done = carry.done ?? []

	return declared.filter((issue) => !done.includes(issue))
}

// The finished issues are named rather than counted, because the reader of a `busy` or `standing`
// message about a named-issue run has to know which ones are already merged before deciding anything.
function done_note(carry: RunCarry): string {
	const done = carry.done ?? []

	return done.length === 0 ? '' : `, issues ${done.join(', ')} done`
}

function describe_carry(carry: RunCarry): string {
	return `${carry.invocation} started ${carry.started_at}; ${String(carry.merged)} merged, ${String(carry.filed)} filed, ${String(carry.failures)} failed in a row, ${String(carry.outages)} outage(s) in a row, ${String(carry.cuts)} cut(s) crossed${done_note(carry)}`
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

// The count refusal reads differently by cause: a record awaiting its successor, or one a successor
// already holds. Both say nothing was counted, so a loop that believed it was advancing a budget stops
// rather than keeping its own tally over a record it does not own (joshuafolkken/kit#1935).
function count_refused_message(carry: RunCarry): string {
	if (carry.is_handed_off === true) {
		return `This budget was handed off at a cut and is waiting for its successor — ${describe_carry(carry)}. Nothing was counted; the cutting session must not advance a handed-off budget.`
	}

	return `A live run owns this budget — ${describe_carry(carry)}, owner pid ${String(carry.owner_pid)} still running. Nothing was counted; only its owner advances the budget.`
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
	count_refused_message,
	describe_carry,
	end_carry,
	expired_message,
	mismatch_message,
	fresh_carry,
	is_count_refused,
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
	retrospective_done_of,
	standing_message,
	unknown_message,
	unreadable_message,
}

export type { CarryChange, CarryClaim, CarryClaimRequest, CarryOwner, CarryRead, RunCarry }
export { run_carry }
