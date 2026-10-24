import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { json_value } from '#scripts/lib/json-value'
import type { StopFinding } from '#scripts/run/ship/run-ship-review'
import { z } from 'zod'

// The durable record of every review finding that stopped a `josh ship` — one JSON line per finding,
// with its kind, the `<file>[:<line>]` it cites and its first sentence, read back by
// `josh review:stops` (joshuafolkken/kit#4519). The lane ledger's stop line keeps only the kinds, and
// the finding's text was only in the ship log in the temp root, which a reboot clears.
//
// **It lives in the git common directory**, beside the test-read map: every lane worktree of one clone
// appends to the same file, and a reboot keeps it. Appended with the lane ledger's `append`, so
// concurrent lanes never lose each other's lines.
//
// **A test run writes nothing** unless it passes its own path, the lane ledger's rule: the writer sits on
// the ship's stop path, which many suites exercise.

const LOG_FILE = 'review-stops.jsonl'
const LINE_SEPARATOR = '\n'

const stop_line_schema = z.object({
	at: z.string(),
	issue: z.number(),
	stage: z.string(),
	kind: z.string(),
	location: z.string(),
	sentence: z.string(),
	fixed: z.boolean().optional(),
})

type StopLine = z.infer<typeof stop_line_schema>

// One stopped review: the issue, the stage that stopped and the findings that decided it. A round that
// passed on fixes made in place is recorded too, marked `is_fixed`, so the lane's next review still sees
// the constraint each fix met (joshuafolkken/kit#4780); `review:stops` leaves those lines out.
interface ReviewStop {
	issue: number
	stage: string
	findings: ReadonlyArray<StopFinding>
	is_fixed?: boolean
}

function target(): string | undefined {
	if (process.env['VITEST'] !== undefined) return undefined

	const common = git_common_directory.repository()

	return common === undefined
		? undefined
		: path.join(common, git_common_directory.STATE_DIRECTORY, LOG_FILE)
}

function write(destination: string, stop: ReviewStop): void {
	const at = new Date().toISOString()
	const mark = stop.is_fixed === true ? { fixed: true } : {}

	mkdirSync(path.dirname(destination), { recursive: true })

	for (const finding of stop.findings) {
		lane_ledger.append(destination, {
			at,
			issue: stop.issue,
			stage: stop.stage,
			...finding,
			...mark,
		})
	}
}

// Best-effort, as the lane ledger is: a record must never fail the stop it records.
function record(stop: ReviewStop, log_path: string | undefined = target()): void {
	if (log_path === undefined || stop.findings.length === 0) return

	try {
		write(log_path, stop)
	} catch {
		// Recording is best-effort: a failed append is dropped rather than raised into the ship's stop.
	}
}

function parse_line(line: string): StopLine | undefined {
	return stop_line_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(line: StopLine | undefined): line is StopLine {
	return line !== undefined
}

// Every recorded finding, oldest first; a malformed line — a write cut short — is skipped.
function read(log_path: string | undefined = target()): ReadonlyArray<StopLine> {
	const raw = log_path === undefined ? undefined : stamp_file.read_stamp_text(log_path)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

const review_stop_log = { read, record, target }

export type { ReviewStop, StopLine }
export { review_stop_log }
