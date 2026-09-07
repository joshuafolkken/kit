import { randomBytes } from 'node:crypto'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_checkout, type ReviewCheckout } from './review-checkout'

// The record that says which checkout a `/code-review` actually read (joshuafolkken/kit#1522).
//
// **The root cause is not ours to fix.** `/code-review` is forked by the harness and inherits the
// session's working directory; nothing in this repository decides that. What *is* ours is the
// direction the error falls in. A review that read the wrong tree reads already-merged, already-
// reviewed code, finds nothing, and **reports that silence as approval** — so the run commits and
// merges a diff nobody read. Detection is therefore the deliverable: a review that cannot show which
// tree it read is treated as no review at all.
//
// **Three records, because the two ends cannot reach each other's temp key.** `stamp_file` keys a
// record by the digest of whatever string it is handed, and `review-stamps.ts` hands it
// `PROJECT_ROOT` — which is `process.cwd()`, so a fork running somewhere else misses the record
// entirely. That property is exactly what makes the guess detectable, and it is also what stops the
// fork looking the expectation up. So the pointer is keyed on this checkout, and the expectation and
// the attestation are keyed on a **nonce** the brief prints — a string both ends hold, reachable from
// any working directory on the machine.
//
// - **pointer** (keyed on `PROJECT_ROOT`) — the nonce of the review this checkout most recently
//   briefed. The run reads it to find out what to check.
// - **expectation** (keyed on the nonce) — the checkout the brief described. The fork reads it to
//   find out whether it is in the right place.
// - **attestation** (keyed on the nonce) — the checkout the fork actually read.
//
// **Absence is a failure, never a pass.** A fork that ignored the instruction leaves no attestation,
// and `check` answers `missing` rather than `ok`: the one shape this record must never take is the
// one the defect already had.

const POINTER_PREFIX = 'josh-review-target-'
const EXPECT_PREFIX = 'josh-review-expect-'
const ATTEST_PREFIX = 'josh-review-attest-'

// Long enough that two runs on one machine cannot collide, short enough to retype from a printed
// brief without wrapping.
const NONCE_BYTES = 8

// The same eight hours `josh run:hold` expires a record after, and for the same reason: a run that
// crashed before `josh followup` must not hold the next one hostage for good. **The staleness is
// only ever read in the direction that removes the requirement**, so a bound set too short can
// never turn a real mismatch into a pass — it can only stop demanding an attestation for a brief
// nobody is reviewing any more.
const HOURS_BEFORE_STALE = 8
const MILLISECONDS_PER_HOUR = 3_600_000
const STALE_AFTER_MS = HOURS_BEFORE_STALE * MILLISECONDS_PER_HOUR

type AttestStatus = 'ok' | 'missing' | 'mismatch' | 'not-required'

interface AttestVerdict {
	status: AttestStatus
	nonce?: string
	expected?: ReviewCheckout
	actual?: ReviewCheckout
}

interface PointerRecord {
	nonce: string
	taken_at: string
}

function pointer_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(POINTER_PREFIX, root)
}

function expect_path(nonce: string): string {
	return stamp_file.stamp_path(EXPECT_PREFIX, nonce)
}

function attest_path(nonce: string): string {
	return stamp_file.stamp_path(ATTEST_PREFIX, nonce)
}

// `undefined` for both "there is no record" and "the record does not parse". They are the same answer
// here — nothing trustworthy is on disk — and the callers below turn that into either
// `not-required` or `missing`, never into `ok`.
function read_json(source: string): unknown {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

function is_record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function string_field(value: Record<string, unknown>, key: string): string | undefined {
	const field = value[key]

	return typeof field === 'string' ? field : undefined
}

function to_checkout(value: unknown): ReviewCheckout | undefined {
	if (!is_record(value)) return undefined

	const root = string_field(value, 'root')
	const branch = string_field(value, 'branch')
	const head = string_field(value, 'head')

	if (root === undefined || branch === undefined || head === undefined) return undefined

	return { root, branch, head }
}

function to_pointer(value: unknown): PointerRecord | undefined {
	if (!is_record(value)) return undefined

	const nonce = string_field(value, 'nonce')
	const taken_at = string_field(value, 'taken_at')

	if (nonce !== undefined && taken_at !== undefined) return { nonce, taken_at }

	return undefined
}

function read_pointer(root?: string): PointerRecord | undefined {
	return to_pointer(read_json(pointer_path(root)))
}

function read_expectation(nonce: string): ReviewCheckout | undefined {
	return to_checkout(read_json(expect_path(nonce)))
}

function read_attestation(nonce: string): ReviewCheckout | undefined {
	return to_checkout(read_json(attest_path(nonce)))
}

// The two nonce-keyed records of one contract, removed together. `undefined` means there was no
// pointer to name them, which is nothing to remove rather than an error.
function drop_records(pointer: PointerRecord | undefined): void {
	if (pointer === undefined) return

	stamp_file.remove_stamp(expect_path(pointer.nonce))
	stamp_file.remove_stamp(attest_path(pointer.nonce))
}

// An unparseable timestamp reads as stale rather than as fresh, so a corrupted record drops the
// requirement instead of wedging every merge in the checkout that holds it.
function is_stale(taken_at: string, now: number): boolean {
	const taken = Date.parse(taken_at)

	return Number.isNaN(taken) || now - taken > STALE_AFTER_MS
}

// **The write is not swallowed, unlike the round-1 snapshot's.** A snapshot that fails to record
// widens the next review; a target that fails to record *removes* the guard, and the brief would go
// on to print a nonce nothing can be attested against. So the brief fails instead of printing a
// contract it cannot hold.
//
// **A fresh nonce every time, and the previous one's records dropped with it.** Re-recording is the
// safe direction — the new contract has nothing attesting it yet, so the check demands a new
// attestation rather than accepting the one an earlier round already satisfied. Leaving the old pair
// on disk would only be litter, but an orphaned expectation is also a nonce a fork could still attest
// against, which is a contract nobody is checking.
function record_target(checkout: ReviewCheckout, root?: string): string {
	const nonce = randomBytes(NONCE_BYTES).toString('hex')
	const taken_at = new Date().toISOString()

	drop_records(read_pointer(root))
	stamp_file.write_stamp(expect_path(nonce), { ...checkout, taken_at })
	stamp_file.write_stamp(pointer_path(root), { nonce, taken_at })

	return nonce
}

// **The attestation is written whether or not it matches.** A mismatch recorded is what lets the run
// say *which* tree was read instead of only that something was wrong, and a fork that stops on the
// non-zero exit has still left the evidence behind.
function attest(nonce: string, actual: ReviewCheckout): AttestVerdict {
	const expected = read_expectation(nonce)

	if (expected === undefined) return { status: 'missing', nonce, actual }

	stamp_file.write_stamp(attest_path(nonce), { ...actual, taken_at: new Date().toISOString() })

	if (review_checkout.is_same_checkout(expected, actual)) {
		return { status: 'ok', nonce, expected, actual }
	}

	return { status: 'mismatch', nonce, expected, actual }
}

// The one verdict that lets a run carry on without an attestation, so it is written once and every
// arm that reaches it returns the same thing.
function not_required(): AttestVerdict {
	return { status: 'not-required' }
}

// **A pointer with no expectation beside it is `missing`, not `not-required`.** The pair can come
// apart: `record_target` drops the previous nonce's records before it writes the new ones, so a
// failed write leaves a live pointer naming an expectation that is gone. Read as "nothing to check",
// every merge in that checkout would pass unguarded until the pointer expired — absence answering
// `ok` by another route, which is the one thing this module must never do.
function verdict_for(nonce: string): AttestVerdict {
	const expected = read_expectation(nonce)

	if (expected === undefined) return { status: 'missing', nonce }

	const actual = read_attestation(nonce)

	if (actual === undefined) return { status: 'missing', nonce, expected }

	if (review_checkout.is_same_checkout(expected, actual)) {
		return { status: 'ok', nonce, expected, actual }
	}

	return { status: 'mismatch', nonce, expected, actual }
}

// **`not-required` is the only answer that means "carry on without an attestation", and it is
// reached from exactly two states**: no brief was recorded in this checkout at all, or the one that
// was is older than a run **and nothing ever answered it**. A project that never runs
// `josh review:brief` is therefore unaffected, which is what keeps the refusal confined to the
// population it is about.
//
// **Staleness is read after the verdict, never before it.** The expiry exists so a run that crashed
// before `josh followup` cannot lock the checkout — that is a statement about an *unanswered*
// contract. A recorded `mismatch` is not unanswered: it is evidence that a review read the wrong
// tree, and evidence does not expire. Checked first, a mismatch older than eight hours would answer
// `not-required` and the merge would go through on exactly the review this whole record exists to
// catch — a run that parks, waits on CI or resumes the next morning reaches that state normally.
function check(now: number = Date.now(), root?: string): AttestVerdict {
	const pointer = read_pointer(root)

	if (pointer === undefined) return not_required()

	const verdict = verdict_for(pointer.nonce)

	if (verdict.status === 'missing' && is_stale(pointer.taken_at, now)) return not_required()

	return verdict
}

// The pointer is keyed on the repository root rather than on `process.cwd()`, which is what
// `PROJECT_ROOT` is. `josh review:brief` records against the root it just asked git for, so the check
// has to ask the same question: run the two from different directories — one from `scripts/`, one
// from the root — and they hash different keys, the check finds no pointer, and the merge proceeds
// unguarded with nothing printed. That is the fail-open `review-checkout.ts` refuses `cwd()` for.
async function check_here(now: number = Date.now()): Promise<AttestVerdict> {
	return check(now, await git_command.repository_root())
}

// Called from the one seam a merged run passes through, beside the round-1 snapshot's clear: the
// contract's lifetime is one run, and a record left behind would be the one the *next* run's check
// reads. Cleared out of turn it would drop the guard, so it is called from nowhere else.
function clear(root?: string): void {
	const pointer = read_pointer(root)

	stamp_file.remove_stamp(pointer_path(root))
	drop_records(pointer)
}

// The counterpart to `check_here`, keyed the same way and for the same reason.
async function clear_here(): Promise<void> {
	clear(await git_command.repository_root())
}

const MISMATCH_VERDICT = 'REVIEW TARGET MISMATCH'

function describe_side(label: string, checkout: ReviewCheckout | undefined): string {
	if (checkout === undefined) return `${label}: unknown`

	return `${label}: ${review_checkout.describe_checkout(checkout)}`
}

const MISSING_REASON =
	'The review left no attestation, so there is no evidence it read this checkout at all. A review that read the wrong tree finds nothing wrong and reports no findings, which is indistinguishable from a clean review — so an absent attestation is treated as no review (joshuafolkken/kit#1522).'

const MISMATCH_REASON = `${MISMATCH_VERDICT}: the review attested a different checkout from the one it was briefed on. Its findings — including "no findings" — describe another tree.`

const REMEDY =
	'Re-run `/code-review` with the brief `pnpm josh review:brief` prints, against the checkout named above, and let it run `pnpm josh review:attest <nonce>` from there before it reports.'

// Composed here rather than at each caller so the run, the CLI and the merge gate say the same thing
// about the same state.
function refusal_message(verdict: AttestVerdict): string {
	const reason = verdict.status === 'mismatch' ? MISMATCH_REASON : MISSING_REASON

	return [
		reason,
		describe_side('Briefed on', verdict.expected),
		describe_side('Reviewed', verdict.actual),
		REMEDY,
	].join('\n')
}

const review_attest = {
	ATTEST_PREFIX,
	attest,
	attest_path,
	check,
	check_here,
	clear,
	clear_here,
	EXPECT_PREFIX,
	expect_path,
	MISMATCH_VERDICT,
	MISSING_REASON,
	POINTER_PREFIX,
	pointer_path,
	read_attestation,
	read_expectation,
	read_pointer,
	record_target,
	refusal_message,
	STALE_AFTER_MS,
}

export type { AttestStatus, AttestVerdict }
export { review_attest }
