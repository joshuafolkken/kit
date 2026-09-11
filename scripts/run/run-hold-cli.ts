#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_hold, type HoldRead, type RunHold } from './run-hold'

// `josh run:hold [<N>]` and `josh run:release [<N> | --force]` — the working-tree guard the typed
// entry points ask before they start (joshuafolkken/kit#1091).
//
// **A release names the run it belongs to, exactly as the claim did** (joshuafolkken/kit#1799). The
// record carries no owner until then, so `run:release` removed whatever was there — and the `busy`
// stop message tells a person to type it when they judge a record stale, which is a judgement made
// from outside the run that wrote it. That made the guard's own recovery instruction a way to free a
// live run's tree: the incident of 2026-08-30, reached through the guard meant to prevent it.
//
// **It answers, so the entry point does not judge.** "This one is a small change, it will be fine" is
// the judgement made under time pressure that produced the incident, and it is the same shape
// `delegation-policy.ts` refuses to leave to an agent. A token on standard output is what the entry
// point obeys.
//
// The contract is `epic:next`'s: **standard output carries exactly one token** — `hold`, `busy` or
// `unknown` — and every explanation goes to standard error, so `answer=$(pnpm josh run:hold 1091)`
// captures something a loop can branch on.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const RELEASE_FLAG = '--release'
// What removes a record this run did not write. **The deliberate friction of the whole change**
// (joshuafolkken/kit#1799): every release now names the run it belongs to, and the one act that
// cannot — clearing a record somebody else left behind — is spelled out rather than reached by
// typing the ordinary command.
const FORCE_FLAG = '--force'
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:hold [<issue-number>] | josh run:release [<issue-number> | --force]'

const HOLD_VERDICT = 'hold'
const BUSY_VERDICT = 'busy'
const UNKNOWN_VERDICT = 'unknown'
const RELEASED_VERDICT = 'released'
const NONE_VERDICT = 'none'
// The record is another run's, so nothing was removed. **It is not `none`**: a release that did not
// happen must never read to a script as a tree it has just freed.
const HELD_VERDICT = 'held'

const FORCE_RELEASE_KIND = 'force-release'

type HoldRequest =
	| { kind: 'release'; claimant: string }
	| { kind: typeof FORCE_RELEASE_KIND }
	| { kind: 'claim'; issue: string }

const FORCE_RELEASE_REQUEST: HoldRequest = { kind: FORCE_RELEASE_KIND }

function release_request(claimant: string): HoldRequest {
	return { kind: 'release', claimant }
}

function parse_claim(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [first] = argv

	if (first === undefined) return { kind: 'claim', issue: run_hold.UNNUMBERED_ISSUE }

	if (argv.length > 1 || !ISSUE_NUMBER_PATTERN.test(first)) return undefined

	return { kind: 'claim', issue: first }
}

function parse_release_argument(first: string): HoldRequest | undefined {
	if (first === FORCE_FLAG) return FORCE_RELEASE_REQUEST

	return ISSUE_NUMBER_PATTERN.test(first) ? release_request(first) : undefined
}

// **A bare `run:release` is the unnumbered run's release, not a release of whatever is there.** It
// mirrors the bare claim, which records `new`, so the two spellings stay one pair.
function parse_release(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [first] = argv

	if (first === undefined) return release_request(run_hold.UNNUMBERED_ISSUE)

	return argv.length > 1 ? undefined : parse_release_argument(first)
}

function parse_request(argv: ReadonlyArray<string>): HoldRequest | undefined {
	if (argv[0] === RELEASE_FLAG) return parse_release(argv.slice(1))

	return parse_claim(argv)
}

// One shape for every answer that carries an explanation: the reason to standard error, the single
// token to standard output, and the exit code that says whether anything was established.
function report(message: string, verdict: string, code: number): number {
	console.error(message)
	console.info(verdict)

	return code
}

function report_busy(message: string): number {
	return report(message, BUSY_VERDICT, SUCCESS_EXIT_CODE)
}

function report_hold(): number {
	console.info(HOLD_VERDICT)

	return SUCCESS_EXIT_CODE
}

// What stops a claim, and `undefined` when nothing does. **An unreadable record stops it**: the run
// that wrote it is the one whose uncommitted work would be trampled, so a record that cannot be
// parsed is never read as an idle tree. **And an expired record still stops it while the tree is
// dirty** — that is a run which stopped for a person, and the work is right there in the tree.
async function blocking_message(read: HoldRead): Promise<string | undefined> {
	if (read.kind === 'held') return run_hold.held_message(read.hold)

	if (read.kind === 'unreadable') return run_hold.unreadable_message()

	const is_expired_over_work = read.kind === 'stale' && (await run_hold.is_tree_dirty())

	return is_expired_over_work ? run_hold.uncommitted_message(read.hold) : undefined
}

// A record already here is never overwritten by a claim: overwriting is what the guard exists to
// prevent, and the person who knows the other run has ended clears it with `run:release --force`.
function take_free_tree(target: string, issue: string): number {
	if (run_hold.create_hold(target, issue)) return report_hold()

	return report_busy(run_hold.race_message(run_hold.read_hold(target), target))
}

// **The stale path takes the tree the same exclusive way the free path does.** Replacing an expired
// record with a plain write would tell two sessions that both found it expired that they both won —
// the race the free path was just fixed for, reintroduced one branch over. Removing it first is what
// turns the expired record into a free tree; the create is what decides between the two claimants.
function replace_stale(target: string, issue: string, hold: RunHold): number {
	console.error(run_hold.stale_message(hold))
	run_hold.release_hold(target)

	return take_free_tree(target, issue)
}

async function claim(target: string, issue: string): Promise<number> {
	const read = run_hold.read_hold(target)
	const blocked = await blocking_message(read)

	if (blocked !== undefined) return report_busy(blocked)

	if (read.kind === 'stale') return replace_stale(target, issue, read.hold)

	return take_free_tree(target, issue)
}

function remove_record(target: string, was_present: boolean): number {
	run_hold.release_hold(target)
	console.info(was_present ? RELEASED_VERDICT : NONE_VERDICT)

	return SUCCESS_EXIT_CODE
}

function report_held(hold: RunHold): number {
	return report(run_hold.foreign_release_message(hold), HELD_VERDICT, FAILURE_EXIT_CODE)
}

// A record nothing can parse names no run, so no claimant can match it — and removing it anyway is
// the one thing this path exists to refuse. It answers `unknown` for the reason every other
// unreadable state here does: nothing was established, so nothing may be concluded.
function report_unreadable_release(): number {
	return report(run_hold.unreadable_message(), UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

// **A release removes the record only where the record names the run asking** (joshuafolkken/kit#1799).
// Until then this removed whatever was there, and the `busy` stop message sent a person here to clear
// a record they had judged stale from outside the run that wrote it — so the guard's own recovery
// instruction was a way to free a live run's tree, which is the incident it was written after.
function release(target: string, claimant: string): number {
	const read = run_hold.read_hold(target)

	if (read.kind === 'free') return remove_record(target, false)

	if (read.kind === 'unreadable') return report_unreadable_release()

	if (!run_hold.is_own_hold(read.hold, claimant)) return report_held(read.hold)

	return remove_record(target, true)
}

// The one path that removes a record without matching it, which is why it says what it removed: a
// record genuinely abandoned by a crashed session has no run left to release it, and the eight-hour
// expiry alone leaves a dirty tree held until a person acts.
function force_release(target: string): number {
	const read = run_hold.read_hold(target)

	if (read.kind === 'held' || read.kind === 'stale') {
		console.error(run_hold.forced_release_message(read.hold))
	}

	return remove_record(target, read.kind !== 'free')
}

// A tree whose git directory cannot be read is `unknown` and exits non-zero, never `hold`: the guard
// has established nothing there, and a run that proceeds on it is the run this command exists to stop.
function report_unknown(): number {
	return report(run_hold.unknown_message(), UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function read_worktree(): Promise<string | undefined> {
	try {
		return await run_hold.worktree_directory()
	} catch {
		return undefined
	}
}

async function dispatch(request: HoldRequest, target: string): Promise<number> {
	if (request.kind === 'claim') return await claim(target, request.issue)

	if (request.kind === FORCE_RELEASE_KIND) return force_release(target)

	return release(target, request.claimant)
}

async function answer(request: HoldRequest): Promise<number> {
	const directory = await read_worktree()

	if (directory === undefined) return report_unknown()

	return await dispatch(request, run_hold.hold_path(directory))
}

// **Every path out of here prints exactly one token**, including the ones nobody planned: a permission
// error on the record, or a git binary that is not there, used to leave standard output empty — and an
// empty `$answer` matches none of the three tokens, which an entry point reads as "not busy" before
// walking straight past the guard.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) return report_usage()

	try {
		return await answer(request)
	} catch {
		return report_unknown()
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_hold_cli = {
	BUSY_VERDICT,
	HELD_VERDICT,
	HOLD_VERDICT,
	NONE_VERDICT,
	RELEASED_VERDICT,
	UNKNOWN_VERDICT,
	USAGE,
	blocking_message,
	main,
	parse_request,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_hold_cli }
