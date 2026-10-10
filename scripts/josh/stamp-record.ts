// What every aged record `stamp-file.ts` keeps is asked on the read: is it there, can it be read, and
// has its bound run out.
//
// `run-carry.ts`, `run-cut.ts` and `run-hold.ts` each carried the expiry below, and the first two the
// classification as well. What an unparsable or a future time means is one decision, so it is made
// here once; what differs between the records is their payload, their timestamp field and their bound,
// and that is all a `StampRecordSpec` names.

interface StampRecordSpec<T> {
	parse: (raw: string) => T | undefined
	timestamp_of: (record: T) => string
	max_age_ms: number
}

type StampRecordRead<T> =
	| { kind: 'none' }
	| { kind: 'carried'; record: T }
	| { kind: 'expired'; record: T }
	| { kind: 'unreadable' }

const NONE_READ = { kind: 'none' } as const
const UNREADABLE_READ = { kind: 'unreadable' } as const

// **A time that is not a date is older than any bound, not current.** It passes a schema — it is a
// string — so reading it as current would leave a record nothing can ever expire, which is the one
// state a bound exists to make impossible. A time ahead of `now` (a skewed clock) has a negative age
// and is not older; the bound is exclusive, so a record exactly at it is still current.
function is_older_than(iso: string, max_age_ms: number, now: Date): boolean {
	const at = Date.parse(iso)

	if (Number.isNaN(at)) return true

	return now.getTime() - at > max_age_ms
}

// **A record that cannot be read is `unreadable`, never `none`.** Absent is none; present and
// unparseable is the state a guard must not fall open on.
function classify<T>(
	raw: string | undefined,
	spec: StampRecordSpec<T>,
	now: Date,
): StampRecordRead<T> {
	if (raw === undefined) return NONE_READ

	const record = spec.parse(raw)

	if (record === undefined) return UNREADABLE_READ

	const is_expired = is_older_than(spec.timestamp_of(record), spec.max_age_ms, now)

	return { kind: is_expired ? 'expired' : 'carried', record }
}

const stamp_record = { classify, is_older_than }

export { stamp_record }
export type { StampRecordRead, StampRecordSpec }
