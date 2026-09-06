#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_hold, type HoldRead, type RunHold } from './run-hold'

// `josh run:hold [<N>]` and `josh run:release` — the working-tree guard the typed entry points ask
// before they start (joshuafolkken/kit#1091).
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
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:hold [<issue-number>] | josh run:release'

const HOLD_VERDICT = 'hold'
const BUSY_VERDICT = 'busy'
const UNKNOWN_VERDICT = 'unknown'
const RELEASED_VERDICT = 'released'
const NONE_VERDICT = 'none'

type HoldRequest = { kind: 'release' } | { kind: 'claim'; issue: string }

const RELEASE_REQUEST: HoldRequest = { kind: 'release' }

function parse_claim(argv: ReadonlyArray<string>): HoldRequest | undefined {
	const [first] = argv

	if (first === undefined) return { kind: 'claim', issue: run_hold.UNNUMBERED_ISSUE }

	if (argv.length > 1 || !ISSUE_NUMBER_PATTERN.test(first)) return undefined

	return { kind: 'claim', issue: first }
}

function parse_request(argv: ReadonlyArray<string>): HoldRequest | undefined {
	if (argv[0] === RELEASE_FLAG) return argv.length === 1 ? RELEASE_REQUEST : undefined

	return parse_claim(argv)
}

function report_busy(message: string): number {
	console.error(message)
	console.info(BUSY_VERDICT)

	return SUCCESS_EXIT_CODE
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
// prevent, and the person who knows the other run has ended clears it with `run:release`.
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

function release(target: string): number {
	const read = run_hold.read_hold(target)

	run_hold.release_hold(target)
	console.info(read.kind === 'free' ? NONE_VERDICT : RELEASED_VERDICT)

	return SUCCESS_EXIT_CODE
}

// A tree whose git directory cannot be read is `unknown` and exits non-zero, never `hold`: the guard
// has established nothing there, and a run that proceeds on it is the run this command exists to stop.
function report_unknown(): number {
	console.error(run_hold.unknown_message())
	console.info(UNKNOWN_VERDICT)

	return FAILURE_EXIT_CODE
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

async function answer(request: HoldRequest): Promise<number> {
	const directory = await read_worktree()

	if (directory === undefined) return report_unknown()

	const target = run_hold.hold_path(directory)

	return request.kind === 'release' ? release(target) : await claim(target, request.issue)
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
