import { setTimeout as sleep } from 'node:timers/promises'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'

// How a stopped detached ship goes back to the lane session that launched it, rather than to a fresh
// one that re-reads the diff and the findings (joshuafolkken/kit#4711).
//
// **The session proves it is alive by waiting**: `josh ship:wait` refreshes a heartbeat on every poll,
// and keeps it for one session gap after a chunk ends `pending`, so the session can re-issue the wait
// without the supervisor reading it as gone. A wait that ends for good removes it.
//
// **One side decides who answers a stop, by an exclusive create**: the supervisor writes the stop note
// and waits for the waiter to take it; past the gap it withdraws it and relaunches as before. Taking and
// withdrawing are the same `create_stamp` on one decision record, so exactly one of them wins and a stop
// is never answered twice nor dropped.

const HEARTBEAT_PREFIX = 'josh-ship-waiter-'
const HANDOFF_PREFIX = 'josh-ship-handoff-'
const DECISION_PREFIX = 'josh-ship-handoff-taken-'
const KEY_SEPARATOR = '-'
const TAKEN = 'taken'
const WITHDRAWN = 'withdrawn'
// Long enough for a session to answer a `pending` chunk with the next wait, short enough that a session
// which ended delays its fresh successor by no more than this.
const SESSION_GAP_MS = 120_000
const OFFER_POLL_MS = 1000

const heartbeat_schema = z.object({ at: z.number() })
const offer_schema = z.object({ at: z.number(), note: z.string() })

function path_of(prefix: string, repository: string, issue: string): string {
	return stamp_file.stamp_path(`${prefix}${issue}${KEY_SEPARATOR}`, repository)
}

function beat(repository: string, issue: string, at: number = Date.now()): void {
	stamp_file.replace_stamp(path_of(HEARTBEAT_PREFIX, repository, issue), { at })
}

function leave(repository: string, issue: string): void {
	stamp_file.remove_stamp(path_of(HEARTBEAT_PREFIX, repository, issue))
}

function is_waited(repository: string, issue: string, now: number = Date.now()): boolean {
	const raw = stamp_file.read_stamp_text(path_of(HEARTBEAT_PREFIX, repository, issue))
	const heartbeat = raw === undefined ? undefined : json_value.parse_with(raw, heartbeat_schema)

	return heartbeat !== undefined && now - heartbeat.at < SESSION_GAP_MS
}

function decide(repository: string, issue: string, decision: string): boolean {
	return stamp_file.create_stamp(path_of(DECISION_PREFIX, repository, issue), decision)
}

function clear_offer(repository: string, issue: string): void {
	stamp_file.remove_stamp(path_of(HANDOFF_PREFIX, repository, issue))
	stamp_file.remove_stamp(path_of(DECISION_PREFIX, repository, issue))
}

// An offer is never held past the session gap, so an older one was left by a supervisor that died
// mid-offer and belongs to an earlier attempt, not to the ship this session waits on.
function offered_note(repository: string, issue: string, now: number): string | undefined {
	const raw = stamp_file.read_stamp_text(path_of(HANDOFF_PREFIX, repository, issue))
	const offered = raw === undefined ? undefined : json_value.parse_with(raw, offer_schema)

	return offered !== undefined && now - offered.at < SESSION_GAP_MS ? offered.note : undefined
}

// The waiter's side: the stop note, once this call won it; `undefined` where none is offered or the
// supervisor already withdrew it.
function take(repository: string, issue: string, now: number = Date.now()): string | undefined {
	const note = offered_note(repository, issue, now)

	if (note === undefined || !decide(repository, issue, TAKEN)) return undefined

	stamp_file.remove_stamp(path_of(HANDOFF_PREFIX, repository, issue))

	return note
}

async function await_taken(repository: string, issue: string): Promise<boolean> {
	const decision = path_of(DECISION_PREFIX, repository, issue)

	const is_taken = await poll.poll_until(() => stamp_file.read_stamp_text(decision) !== undefined, {
		attempts: Math.ceil(SESSION_GAP_MS / OFFER_POLL_MS),
		interval_ms: OFFER_POLL_MS,
		sleeper: sleep,
	})
	if (is_taken) return true
	await sleep(OFFER_POLL_MS)

	return !decide(repository, issue, WITHDRAWN)
}

// The supervisor's side: whether a waiting session took `note`. A session that is not waiting is not
// offered anything, so a lane whose child ended relaunches with no delay.
async function offer(repository: string, issue: string, note: string): Promise<boolean> {
	if (!is_waited(repository, issue)) return false

	clear_offer(repository, issue)
	// Renamed into place whole: a waiter polling between an exclusive create and its write would read an
	// empty note, win the decision on it and drop the stop.
	stamp_file.replace_stamp(path_of(HANDOFF_PREFIX, repository, issue), { at: Date.now(), note })
	const is_taken = await await_taken(repository, issue)

	// The decision stays until the next offer clears it: a waiter that read the note just before the
	// withdrawal would otherwise win a fresh decision record and answer the stop a second time.
	stamp_file.remove_stamp(path_of(HANDOFF_PREFIX, repository, issue))

	return is_taken
}

const run_ship_waiter = { SESSION_GAP_MS, beat, is_waited, leave, offer, take }

export { run_ship_waiter }
