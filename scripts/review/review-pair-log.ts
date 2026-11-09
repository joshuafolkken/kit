import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// `review-pairs.jsonl` — one line per paired comparison (joshuafolkken/kit#6902): the Opus and the
// Sonnet reviewer's findings on the same round-1 brief, each with its severity, and each reviewer's
// cost. It lives in the git common directory beside `review-stops.jsonl`, so it outlives the lane
// worktree that recorded it. Nothing that gates reads it.

const LOG_FILE = 'review-pairs.jsonl'
const LINE_SEPARATOR = '\n'
const finding_schema = z.object({ severity: z.string(), line: z.string() })
const side_schema = z.object({
	agent: z.string(),
	model: z.string().optional(),
	usd: z.number().optional(),
	findings: z.array(finding_schema),
})
const pair_line_schema = z.object({
	at: z.string(),
	issue: z.number(),
	opus: side_schema,
	sonnet: side_schema,
})

type PairFinding = z.infer<typeof finding_schema>
type PairSide = z.infer<typeof side_schema>
type PairLine = z.infer<typeof pair_line_schema>

function target(): string | undefined {
	if (process.env['VITEST'] !== undefined) return undefined

	const common = git_common_directory.repository()

	return common === undefined
		? undefined
		: path.join(common, git_common_directory.STATE_DIRECTORY, LOG_FILE)
}

function record(line: PairLine, log_path: string | undefined = target()): boolean {
	if (log_path === undefined) return false
	mkdirSync(path.dirname(log_path), { recursive: true })
	lane_ledger_write.append(log_path, line)

	return true
}

function parse_line(line: string): PairLine | undefined {
	return pair_line_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(line: PairLine | undefined): line is PairLine {
	return line !== undefined
}

// Every recorded comparison, oldest first; a malformed line — a write cut short — is skipped.
function read(log_path: string | undefined = target()): ReadonlyArray<PairLine> {
	const raw = log_path === undefined ? undefined : stamp_file.read_stamp_text(log_path)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

const review_pair_log = { read, record, target }

export type { PairFinding, PairLine, PairSide }
export { review_pair_log }
