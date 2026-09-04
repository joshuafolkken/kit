import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { time_density } from './time-density'

// The disk half of the live density line (joshuafolkken/kit#1329): find the transcript, read enough
// of it, and remember when the line was last emitted.
//
// **It rides the hook that already runs, and adds no second one.** `.claude/settings.json` wires
// `pnpm josh format:edited` to `PostToolUse` for `Edit` and `Write`; a matcher covering every tool
// would put a process start in front of all ~250 calls of a run to say something on a handful of
// them. Editing is also where the signal belongs — `Edit` was the most-called tool of run #1299 at
// 65 calls, almost all of them alone in their turn.
//
// **Nothing here may fail.** A `PostToolUse` hook runs after the edit has landed and cannot undo it,
// so a transcript that is missing, unreadable or not JSON at all ends as "no line", exactly as
// `format-edited-file.ts` treats a formatter it could not start. A transcript whose *last* line was
// caught mid-append is the one case that does not end there: that line is dropped like any other
// unparseable one, and the reading then describes the turn before it — a line about a turn one older
// than the newest, never a wrong one about the newest.

// How much of the transcript's end is read. The file grows to several megabytes over a long run —
// 4.7 MB and 2,712 lines for the largest in this checkout — and reading all of it on every edit would
// put the run's own history in front of every write. A quarter of a megabyte is far more than the ten
// round trips the reading needs and is read in a couple of milliseconds.
const TAIL_BYTES = 262_144
const FILE_START = 0
// **One record per session, keyed on the transcript the payload named**, rather than per checkout the
// way `josh gate`'s stamp is. What is being throttled is a *run*, and a run is one session: keyed on
// the checkout, a session started — or cleared — within the interval of the previous one's line would
// inherit that silence through its opening stretch, which is the part of a run where the correction
// is worth the most. Keying on the transcript path also gives a delegated child its own budget, which
// is right for the same reason: it is a run of its own.
const NOTICE_PREFIX = 'josh-density-notice-'
// No record means nothing has been said yet, and the caller compares `now - this`. Zero makes that
// difference enormous, which is the answer wanted: the first eligible edit of a run emits.
const NEVER_MS = 0

// Only the field this reads. Claude Code hands a `PostToolUse` hook `transcript_path` beside the
// `tool_input` the formatter half uses, so the session's own file is named rather than searched for —
// no home-directory walk, and a delegated unit is answered with its own transcript rather than its
// parent's.
const payload_schema = z.object({ transcript_path: z.string().min(1).optional() })
const notice_schema = z.object({ notified_at_ms: z.number() })

function parse_transcript_path(raw_payload: string): string | undefined {
	const parsed = payload_schema.safeParse(JSON.parse(raw_payload))

	return parsed.success ? parsed.data.transcript_path : undefined
}

// The last `max_bytes` of a file, as text. The leading line is usually cut mid-way, which every
// reader below already handles: an unparseable line is dropped rather than dated.
//
// **Only the bytes `readSync` reports are decoded.** `Buffer.alloc` zero-fills, and a short read — a
// real possibility on the network- and FUSE-backed home directories these transcripts can live on —
// would otherwise leave NUL padding on the end of the text, making the *last* line unparseable. That
// is the one line the turn's call count is read from.
function read_tail(file_path: string, max_bytes: number = TAIL_BYTES): string {
	const descriptor = openSync(file_path, 'r')

	try {
		const { size } = fstatSync(descriptor)
		const length = Math.min(size, max_bytes)
		const buffer = Buffer.alloc(length)
		const read = readSync(descriptor, buffer, FILE_START, length, size - length)

		return buffer.subarray(FILE_START, read).toString('utf8')
	} finally {
		closeSync(descriptor)
	}
}

function notice_path(transcript_path: string): string {
	return stamp_file.stamp_path(NOTICE_PREFIX, transcript_path)
}

// A record that is absent, unreadable, planted by another account or not the shape written here all
// answer `NEVER_MS`. The failure direction is one extra line, never a silenced one.
function last_notice_ms(source: string): number {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return NEVER_MS

	try {
		return notice_schema.parse(JSON.parse(raw)).notified_at_ms
	} catch {
		return NEVER_MS
	}
}

// **Arming the throttle is best-effort, and never costs the line.** The caller prints and exits, so
// this write is the only place the throttle can be armed — but `write_stamp` creates exclusively, so
// a second hook running in the same session, a sticky temp directory, or a path another account owns
// each throw. Swallowed here rather than by the outer guard, which would discard the notice that had
// already been computed and silence exactly what `last_notice_ms` promises never to silence.
function arm_throttle(target: string, now_ms: number): void {
	try {
		stamp_file.write_stamp(target, { notified_at_ms: now_ms })
	} catch {
		// One extra line later is the failure this trades for; a silenced one is not acceptable.
	}
}

function notice_for(raw_payload: string, now_ms: number): string | undefined {
	const transcript_path = parse_transcript_path(raw_payload)

	if (transcript_path === undefined) return undefined

	const reading = time_density.read_window(read_tail(transcript_path))
	const target = notice_path(transcript_path)

	if (!time_density.is_due(reading, now_ms - last_notice_ms(target))) return undefined

	arm_throttle(target, now_ms)

	return time_density.format_notice(reading)
}

// The whole call in one guard: every path above may throw on a file that moved or a payload that is
// not JSON, and neither is worth failing an edit over.
function density_notice(raw_payload: string, now_ms: number = Date.now()): string | undefined {
	try {
		return notice_for(raw_payload, now_ms)
	} catch {
		return undefined
	}
}

const time_density_hook = {
	NOTICE_PREFIX,
	TAIL_BYTES,
	density_notice,
	notice_path,
	read_tail,
}

export { time_density_hook }
