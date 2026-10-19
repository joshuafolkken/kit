import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { cost_audit_kind } from './cost-audit-kind'
import { cost_audit_tool, type ToolCategory } from './cost-audit-tool'

// Reading the transcript store for `josh cost:audit`: every session of this repository and its lanes
// touched since the window opened, each reduced to its kind, its priced requests, the category of every
// call each request issued, and its parsed lines for the guard tally.
//
// **The store is read from the main checkout**, whichever checkout the command runs in:
// `transcript_directories` lists the lane directories only for a checkout that resolves to itself, and
// an audit run from a lane must still see every lane.
//
// **A request is counted once across the corpus.** A resumed session's transcript can carry requests
// an earlier file already holds, so requests are deduplicated by id across every session, the oldest
// session keeping it. The id is the `requestId` `cost-usage.ts` keys on, which names the same billed
// request `message.id` does.

interface AuditSession {
	kind: string
	records: ReadonlyArray<UsageRecord>
	// The categories of the calls each request issued, keyed by request id; a request absent here
	// issued none.
	categories: ReadonlyMap<string, ReadonlyArray<ToolCategory>>
	lines: ReadonlyArray<TranscriptLine>
}

interface SessionParts {
	records: Array<UsageRecord>
	categories: Map<string, Array<ToolCategory>>
	lines: Array<TranscriptLine>
	prompt: string
}

function first_text(raw: string): string {
	const block = cost_blocks
		.parse_line(raw)
		.find((one) => one.type === cost_blocks.TEXT_TYPE && one.text.trim() !== '')

	return block?.text ?? ''
}

function line_categories(line: TranscriptLine): Array<ToolCategory> {
	return line.blocks
		.filter((block) => block.type === cost_blocks.TOOL_USE_TYPE)
		.map((block) => cost_audit_tool.category_of(block.name, block.input))
}

function add_categories(parts: SessionParts, request_id: string, line: TranscriptLine): void {
	const found = line_categories(line)
	const earlier = parts.categories.get(request_id) ?? []

	if (found.length > 0) parts.categories.set(request_id, [...earlier, ...found])
}

function add_line(parts: SessionParts, raw: string): void {
	const outcome = cost_usage.parse_line(raw)
	const line = time_transcript_line.parse_line(raw)

	if (parts.prompt === '') parts.prompt = first_text(raw)
	if (line !== undefined) parts.lines.push(line)
	if (outcome.kind !== 'record') return

	parts.records.push(outcome.record)
	if (line !== undefined) add_categories(parts, outcome.record.request_id, line)
}

// One transcript's text read into a session — the pure half a test drives with fixture lines.
function session_of(text: string, is_delegated: boolean): AuditSession {
	const parts: SessionParts = { records: [], categories: new Map(), lines: [], prompt: '' }

	for (const raw of text.split('\n')) add_line(parts, raw)

	return {
		kind: cost_audit_kind.kind_of(parts.prompt, is_delegated),
		records: cost_usage.dedupe(parts.records),
		categories: parts.categories,
		lines: parts.lines,
	}
}

function without_seen(session: AuditSession, seen: Set<string>): AuditSession {
	const records = session.records.filter((record) => !seen.has(record.request_id))

	for (const record of records) seen.add(record.request_id)

	return { ...session, records }
}

// Sessions oldest first, each keeping only the requests no earlier session already counted.
function dedupe_across(sessions: ReadonlyArray<AuditSession>): Array<AuditSession> {
	const seen = new Set<string>()

	return sessions.map((session) => without_seen(session, seen))
}

function session_files(cwd: string, since_ms: number): Array<SessionFile> {
	const main = cost_transcript.session_cwd(cwd)
	const files = cost_transcript.list_sessions_across(cost_transcript.transcript_directories(main))

	return files.filter((file) => file.modified_ms >= since_ms).toReversed()
}

// Every session touched since `since_ms`. A file last written before then holds no request inside the
// window, so it is not read at all.
function load(cwd: string, since_ms: number): Array<AuditSession> {
	const sessions = session_files(cwd, since_ms).map((file) =>
		session_of(cost_transcript.read_raw(file), file.is_delegated),
	)

	return dedupe_across(sessions)
}

const cost_audit_read = { session_of, dedupe_across, load }

export type { AuditSession }
export { cost_audit_read }
