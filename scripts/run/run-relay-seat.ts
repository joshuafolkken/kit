import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import type { CarryRead } from './run-carry'

// Which session relays a running `backlogrun`'s event stream to a person (joshuafolkken/kit#2480).
//
// **The reader is the attached session, before and after a cut.** Before the cut it is the record's
// owner. After the cut a headless successor adopts the record and rewrites its owner, so the session
// that cut — still attached, still the only one a person is watching — would no longer be named
// anywhere, and "I am not the parent any more" read as leave to stop relaying. The seat is that
// session's name kept past the hand-off: `run:carry --cut` writes the cutting process here, keyed on
// the carry record, and only an attached (non-headless) cutter takes it, so a headless successor's
// own cut never moves the seat off the session a person is looking at.
//
// **The seat belongs to one invocation.** Every run in a checkout shares the carry path, and nothing
// removes the seat when a run ends, so it carries the invocation's `started_at` — which a cut and an
// adoption both keep — and a seat left by an earlier run never seats anyone in the next.

const SEAT_PREFIX = 'josh-run-relay-seat-'

const seat_schema = z.object({ pid: z.number().int().positive(), started_at: z.string() })

type RelaySeat = z.infer<typeof seat_schema>

function seat_path(carry_target: string): string {
	return stamp_file.stamp_path(SEAT_PREFIX, carry_target)
}

// Best-effort, as every relay record is: a seat that cannot be written costs the nudge, never the cut.
function take(carry_target: string, pid: number | undefined, started_at: string): void {
	if (pid === undefined) return

	try {
		stamp_file.write_stamp(seat_path(carry_target), { pid, started_at })
	} catch {
		// No seat is the fail-open answer: nothing is refused on its account.
	}
}

function read_seat(carry_target: string): RelaySeat | undefined {
	const text = stamp_file.read_stamp_text(seat_path(carry_target))

	if (text === undefined) return undefined

	try {
		const parsed = seat_schema.safeParse(JSON.parse(text))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// A run is still going while its record is there — `expired` included, since a spent budget may yet
// have lanes finishing and a person watching them. An ended run (`none`) owes no relay.
function is_running(read: CarryRead): read is Extract<CarryRead, { kind: 'carried' | 'expired' }> {
	return read.kind === 'carried' || read.kind === 'expired'
}

// The pids that relay this run: its owner, and the seat when the seat was taken in this invocation.
function relay_pids(
	read: Extract<CarryRead, { kind: 'carried' | 'expired' }>,
	seat: RelaySeat | undefined,
): ReadonlyArray<number | undefined> {
	const is_this_run = seat?.started_at === read.carry.started_at

	return [read.carry.owner_pid, is_this_run ? seat.pid : undefined]
}

// This session owes the relay when the run is still going and either the record's owner or the seat
// is one of its own ancestors — the `--owner "$PPID"` idiom `run-headless.ts` reads the same way. The
// ancestry is a thunk because it walks the process tree, which a stop with no run going never needs.
function is_seated(
	read: CarryRead,
	seat: RelaySeat | undefined,
	ancestry: () => ReadonlySet<number>,
): boolean {
	if (!is_running(read)) return false

	const own = ancestry()

	return relay_pids(read, seat).some((pid) => pid !== undefined && own.has(pid))
}

const run_relay_seat = { SEAT_PREFIX, is_seated, read_seat, seat_path, take }

export type { RelaySeat }
export { run_relay_seat }
