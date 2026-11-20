import { homedir } from 'node:os'
import path from 'node:path'
import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { file_reader } from '#scripts/lib/read-file'
import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { z } from 'zod'
import { cost_audit_kind } from './cost-audit-kind'
import { cost_audit_resume } from './cost-audit-resume'
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
	// Whether the transcript is a dispatched lane child's own session: in a lane checkout's directory and
	// not a delegated unit, which the kind cannot tell apart when its prompt names `/code-review`.
	is_lane: boolean
	// The Issue of the lane checkout whose directory holds the transcript, its delegated units included;
	// absent outside a lane. The phase table reads the lane's stages by it (joshuafolkken/kit#5936).
	issue?: number | undefined
	// A delegated unit's agent type from its `meta.json`; absent for a main session or a unit with none.
	agent_type?: string | undefined
	// Why a `resume` session was started (`cost-audit-resume.ts`); absent for every other kind.
	trigger?: string | undefined
	records: ReadonlyArray<UsageRecord>
	// The categories of the calls each request issued, keyed by request id; a request absent here
	// issued none.
	categories: ReadonlyMap<string, ReadonlyArray<ToolCategory>>
	lines: ReadonlyArray<TranscriptLine>
}

const USER_TYPE = 'user'
const LANE_ISSUE_PATTERN = /-(\d+)$/u
const TRANSCRIPT_EXTENSION = /\.jsonl$/u
const META_SCHEMA = z.object({ agentType: z.string().min(1) })

interface SessionParts {
	records: Array<UsageRecord>
	categories: Map<string, Array<ToolCategory>>
	lines: Array<TranscriptLine>
	prompt: string
	// The text of every user line after the opening prompt, for the outage relaunch's prompt.
	prompts: Array<string>
}

function texts_of(raw: string): Array<string> {
	return cost_blocks
		.parse_line(raw)
		.filter((one) => one.type === cost_blocks.TEXT_TYPE && one.text.trim() !== '')
		.map((one) => one.text)
}

function add_prompts(parts: SessionParts, raw: string, line: TranscriptLine | undefined): void {
	if (parts.prompt === '') parts.prompt = texts_of(raw)[0] ?? ''
	else if (line?.type === USER_TYPE) parts.prompts.push(...texts_of(raw))
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

	add_prompts(parts, raw, line)
	if (line !== undefined) parts.lines.push(line)
	if (outcome.kind !== 'record') return

	parts.records.push(outcome.record)
	if (line !== undefined) add_categories(parts, outcome.record.request_id, line)
}

// One transcript's text read into a session — the pure half a test drives with fixture lines.
function session_of(text: string, is_delegated: boolean, is_lane = false): AuditSession {
	const parts: SessionParts = {
		records: [],
		categories: new Map(),
		lines: [],
		prompt: '',
		prompts: [],
	}

	for (const raw of text.split('\n')) add_line(parts, raw)

	const opening = cost_audit_kind.kind_of(parts.prompt, is_delegated)
	const { kind, trigger } = cost_audit_resume.classify(opening, [parts.prompt, ...parts.prompts])

	return {
		kind,
		is_lane: is_lane && !is_delegated,
		trigger,
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

// The lane directory holding `file`, `undefined` outside every lane. A delegated unit's transcript sits
// below its session's directory, so the test is a path prefix.
function lane_of(file_path: string, lanes: ReadonlyArray<string>): string | undefined {
	return lanes.find((directory) => file_path.startsWith(`${directory}${path.sep}`))
}

// A lane directory's Issue: the digits `lane_transcript_directories` matched after its last `-`.
function issue_of(file_path: string, lanes: ReadonlyArray<string>): number | undefined {
	const digits = LANE_ISSUE_PATTERN.exec(lane_of(file_path, lanes) ?? '')?.[1]

	return digits === undefined ? undefined : Number(digits)
}

function json_or_undefined(text: string): unknown {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

// A delegated unit's agent type, read from the `agent-<id>.meta.json` beside its transcript; absent
// when the file is missing or names none, so the unit falls into its kind's row (joshuafolkken/kit#5971).
function agent_type_of(transcript_path: string): string | undefined {
	const meta_path = transcript_path.replace(TRANSCRIPT_EXTENSION, '.meta.json')
	const text = file_reader.read_if_readable(meta_path)

	if (text === undefined) return undefined

	const parsed = META_SCHEMA.safeParse(json_or_undefined(text))

	return parsed.success ? parsed.data.agentType : undefined
}

function file_session(file: SessionFile, lanes: ReadonlyArray<string>): AuditSession {
	const issue = issue_of(file.path, lanes)
	const session = session_of(cost_transcript.read_raw(file), file.is_delegated, issue !== undefined)
	const agent_type = file.is_delegated ? agent_type_of(file.path) : undefined

	return { ...session, issue, agent_type }
}

type FileFilter = (file: SessionFile, lanes: ReadonlyArray<string>) => boolean

// The sessions touched since `since_ms` that `keep` admits. A file last written before then holds no
// request inside the window, and a file `is_kept` refuses is never opened.
function load_where(cwd: string, since_ms: number, is_kept: FileFilter): Array<AuditSession> {
	const lanes = cost_transcript.lane_transcript_directories(
		cost_transcript.session_cwd(cwd),
		homedir(),
	)
	const files = session_files(cwd, since_ms).filter((file) => is_kept(file, lanes))

	return cost_audit_resume.with_triggers(
		dedupe_across(files.map((file) => file_session(file, lanes))),
	)
}

function load(cwd: string, since_ms: number): Array<AuditSession> {
	return load_where(cwd, since_ms, () => true)
}

function is_lane_child_file(file: SessionFile, lanes: ReadonlyArray<string>): boolean {
	return !file.is_delegated && issue_of(file.path, lanes) !== undefined
}

// The lane children's own sessions alone — all `cost:audit --density` reads (joshuafolkken/kit#8284), so
// the main checkout's and the delegated units' transcripts are never opened.
function load_lane_children(cwd: string, since_ms: number): Array<AuditSession> {
	return load_where(cwd, since_ms, is_lane_child_file)
}

const cost_audit_read = {
	session_of,
	dedupe_across,
	issue_of,
	agent_type_of,
	load,
	load_lane_children,
}

export type { AuditSession }
export { cost_audit_read }
