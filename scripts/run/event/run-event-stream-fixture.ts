import { stamp_file } from '#scripts/josh/stamp-file'
import { run_event_stream } from './run-event-stream'

// The stream a bound suite fills to `EVENT_CAP` and past it — one copy, so the suites cannot drift on
// how a full stream is written. Appending fifteen thousand lines one at a time rewrites the file each
// time, so all but the last line are written in one go and the last goes through `append`, whose bound
// then trims the stream once, as the per-line appends would have.

// The time every filled line carries: the bound never reads it.
const FILLED_AT = '2026-10-01T00:00:00.000Z'

// `count` lines of `kind`, the `index`-th reading `text_of(index)`.
function fill(
	target: string,
	kind: string,
	count: number,
	text_of: (index: number) => string,
): void {
	const existing = run_event_stream.read_events(target)
	const first = (existing.at(-1)?.pos ?? 0) + 1
	const seeded = Array.from({ length: count - 1 }, (_, index) => ({
		pos: first + index,
		at: FILLED_AT,
		kind,
		text: text_of(index),
	}))
	const serialized = [...existing, ...seeded].map((event) => JSON.stringify(event))

	stamp_file.replace_text_stamp(target, `${serialized.join('\n')}\n`)
	run_event_stream.append(target, kind, text_of(count - 1), FILLED_AT)
}

const run_event_stream_fixture = { fill }

export { run_event_stream_fixture }
