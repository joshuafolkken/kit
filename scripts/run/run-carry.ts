import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { git_command } from '#scripts/git/git-command'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

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

interface RunCarry {
	// The invocation as the person typed it, so a resumed session runs the same command rather than
	// one it inferred. `CLAUDE.md` → "Explicit invocation required" forbids inferring; naming the
	// invocation is what leaves nothing to infer.
	invocation: string
	started_at: string
	merged: number
	filed: number
	cuts: number
}

// Every counter is an increment rather than a total: a run that sent a total would be sending an
// arithmetic it had done in its head, which is the one-shot judgement joshuafolkken/kit#1460
// measured a run walking past.
interface CarryChange {
	merged?: number
	filed?: number
	cuts?: number
}

type CarryRead =
	| { kind: 'none' }
	| { kind: 'carried'; carry: RunCarry }
	| { kind: 'expired'; carry: RunCarry }
	| { kind: 'unreadable' }

const NONE_READ: CarryRead = { kind: 'none' }
const UNREADABLE_READ: CarryRead = { kind: 'unreadable' }

const run_carry_schema = z.object({
	invocation: z.string(),
	started_at: z.string(),
	merged: z.number(),
	filed: z.number(),
	cuts: z.number(),
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

function fresh_carry(invocation: string, now: Date): RunCarry {
	return {
		invocation,
		started_at: now.toISOString(),
		merged: NO_INCREMENT,
		filed: NO_INCREMENT,
		cuts: NO_INCREMENT,
	}
}

// Replaces whatever is there. The caller decides whether replacing is right — `--begin` replaces an
// expired record because that run's bound is spent, and never replaces a live one.
function begin_carry(target: string, invocation: string, now: Date = new Date()): RunCarry {
	const carry = fresh_carry(invocation, now)

	stamp_file.write_stamp(target, carry)

	return carry
}

function apply_change(target: string, carry: RunCarry, change: CarryChange): RunCarry {
	const next: RunCarry = {
		...carry,
		merged: carry.merged + (change.merged ?? NO_INCREMENT),
		filed: carry.filed + (change.filed ?? NO_INCREMENT),
		cuts: carry.cuts + (change.cuts ?? NO_INCREMENT),
	}

	stamp_file.write_stamp(target, next)

	return next
}

function end_carry(target: string): void {
	stamp_file.remove_stamp(target)
}

function describe_carry(carry: RunCarry): string {
	return `${carry.invocation} started ${carry.started_at}; ${String(carry.merged)} merged, ${String(carry.filed)} filed, ${String(carry.cuts)} cut(s) crossed`
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
	apply_change,
	begin_carry,
	carry_path,
	classify,
	describe_carry,
	end_carry,
	expired_message,
	mismatch_message,
	fresh_carry,
	is_expired,
	parse_carry,
	read_carry,
	repository_directory,
	unknown_message,
	unreadable_message,
}

export type { CarryChange, CarryRead, RunCarry }
export { run_carry }
