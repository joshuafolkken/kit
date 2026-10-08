import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import type { CarryRead } from './run-carry'

// The run `run:carry --end` last ended (joshuafolkken/kit#3439). `--end` removes the carry record, and
// the carry's `started_at` was the only mark of where an invocation began on the shared event stream, so
// `run:board` lost the finished run the moment it ended and fell back to "no run". Nothing wrote a
// whole-run `stop` either. This keeps the three facts the board needs to redraw that run — what it was
// asked to do, when it began and when it ended — read from a record rather than guessed on screen.
//
// **One record, overwritten by the next `--end`**: the board keeps only the run before the next one, and
// a run that begins replaces nothing here — its carry record is what the board reads while it runs.

const ENDED_PREFIX = 'josh-run-ended-'

const ended_run_schema = z.object({
	invocation: z.string(),
	started_at: z.string(),
	ended_at: z.string(),
})

type EndedRun = z.infer<typeof ended_run_schema>

// Keyed on the common git directory, as the carry record is, so every lane reads the same one.
function ended_path(git_directory: string): string {
	return stamp_file.stamp_path(ENDED_PREFIX, git_directory)
}

// Records the run a `--end` is about to remove. A read with no record — `none` or `unreadable` — names
// no run, so it leaves the previous record standing rather than erasing it.
function record_ended(target: string, read: CarryRead, now: Date = new Date()): void {
	if (read.kind !== 'carried' && read.kind !== 'expired') return

	const { invocation, started_at } = read.carry

	stamp_file.replace_stamp(target, { invocation, started_at, ended_at: now.toISOString() })
}

function parse_ended(raw: string): EndedRun | undefined {
	try {
		const parsed = ended_run_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// `undefined` when no run has ended here, or the record does not read.
function read_ended(target: string): EndedRun | undefined {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? undefined : parse_ended(raw)
}

const run_carry_ended = { ended_path, read_ended, record_ended }

export { run_carry_ended }
export type { EndedRun }
