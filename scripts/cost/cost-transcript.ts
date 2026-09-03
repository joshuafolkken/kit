import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { cost_usage, type UsageRecord } from './cost-usage'

// Finding and reading Claude Code's session transcripts (joshuafolkken/kit#962).
//
// They live at `~/.claude/projects/<slug>/<session-id>.jsonl`, where the slug is the working
// directory with every character that is not a letter, digit or hyphen turned into a hyphen.
// Verified against this machine's own transcript directory: a working directory named
// `slug_probe.dir` produced `slug-probe-dir`, and no directory name there contains any other
// character. Replacing only `/` and `.` left every project whose path holds an underscore or a
// space resolving to a directory that does not exist, and the command then reported "no
// transcripts found" for a project whose transcripts were sitting right there.
//
// `homedir()` is otherwise forbidden under `scripts/` and this file is the single allowed exception
// — see `scripts/no-global-shim-write.test.ts`. The guard exists to stop a lifecycle hook *writing*
// to a shared, user-level location; this module only ever reads, and the test enforces that.

const TRANSCRIPT_ROOT = path.join('.claude', 'projects')
const TRANSCRIPT_EXTENSION = '.jsonl'
const SLUG_PATTERN = /[^a-zA-Z0-9-]/gu

function project_slug(cwd: string): string {
	return cwd.replaceAll(SLUG_PATTERN, '-')
}

function transcript_directory(cwd: string, home: string = homedir()): string {
	return path.join(home, TRANSCRIPT_ROOT, project_slug(cwd))
}

interface SessionFile {
	session_id: string
	path: string
	modified_ms: number
}

function to_session_file(directory: string, name: string): SessionFile | undefined {
	const full_path = path.join(directory, name)

	try {
		return {
			session_id: name.slice(0, -TRANSCRIPT_EXTENSION.length),
			path: full_path,
			modified_ms: statSync(full_path).mtimeMs,
		}
	} catch {
		return undefined
	}
}

// An unreadable directory yields nothing; the caller reports that as a missing transcript rather
// than as a run that cost zero.
function read_directory(directory: string): Array<string> {
	try {
		return readdirSync(directory)
	} catch {
		return []
	}
}

// Newest first, so "the run that just finished" is the default with no argument.
function list_sessions(directory: string): Array<SessionFile> {
	return read_directory(directory)
		.filter((name) => name.endsWith(TRANSCRIPT_EXTENSION))
		.map((name) => to_session_file(directory, name))
		.filter((file): file is SessionFile => file !== undefined)
		.toSorted((left, right) => right.modified_ms - left.modified_ms)
}

// What one transcript yielded, including what it could not yield. The two failure counts are
// reported rather than folded into silence: a session whose lines are all unparseable and a session
// that genuinely cost nothing produce the same totals, and only these counts tell them apart.
interface SessionUsage {
	session_id: string
	records: Array<UsageRecord>
	no_usage_lines: number
	malformed_lines: number
	is_readable: boolean
	// The session's first request's whole billed input: the preamble that existed before any work
	// happened. Computed here because only the session knows which of its records came first — a
	// caller holding a filtered slice cannot recover it.
	baseline_tokens: number
}

// Built per call rather than shared: a single `records: []` spread into every unreadable session
// would hand them all the same array instance.
function empty_session(): Omit<SessionUsage, 'session_id'> {
	return {
		records: [],
		no_usage_lines: 0,
		malformed_lines: 0,
		is_readable: false,
		baseline_tokens: 0,
	}
}

function tally(content: string): Omit<SessionUsage, 'session_id'> {
	const outcomes = content.split('\n').map((line) => cost_usage.parse_line(line))
	const records: Array<UsageRecord> = outcomes.flatMap((outcome) =>
		outcome.kind === 'record' ? [outcome.record] : [],
	)

	const unique = cost_usage.dedupe(records)
	const [first] = unique

	return {
		records: unique,
		no_usage_lines: outcomes.filter((outcome) => outcome.kind === 'no_usage').length,
		malformed_lines: outcomes.filter((outcome) => outcome.kind === 'malformed').length,
		is_readable: true,
		baseline_tokens: first === undefined ? 0 : cost_usage.billed_input(first.totals),
	}
}

function read_text(file_path: string): string | undefined {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return undefined
	}
}

function read_session(file: SessionFile): SessionUsage {
	const content = read_text(file.path)

	if (content === undefined) return { session_id: file.session_id, ...empty_session() }

	return { session_id: file.session_id, ...tally(content) }
}

// The transcript's own text, for the readers that need the lines rather than the usage totals —
// `cost-blocks.ts` classifies what the conversation is made of and cannot work from `UsageRecord`s.
// An unreadable file yields an empty string, exactly as `read_session` yields an empty session:
// "could not be read" is already reported through `is_readable`, and throwing here would turn one
// missing session into a failed command.
function read_raw(file: SessionFile): string {
	return read_text(file.path) ?? ''
}

// What to say when the discovery above found nothing. It lives here rather than in either command
// because both `josh cost` and `josh time` reach it, and a second copy would drift the moment one of
// them learned something about where transcripts live (joshuafolkken/kit#1267). The message, not the
// printing: each command owns its own streams and exit code.
//
// **The directory is passed in, not resolved here.** The whole point of the message is to name where
// the command looked, so it has to be the same string the search used — resolving it a second time
// can name a directory that was never searched.
//
// "No transcript was found" and "this run cost nothing" are different answers, and only one of them
// is ever true — which is why neither command may report an empty corpus as a zero.
function missing_message(directory: string, session_id: string | undefined): Array<string> {
	if (session_id !== undefined) return [`No transcript named ${session_id} under ${directory}`]

	return [
		`No transcripts found under ${directory}`,
		'Claude Code writes them per project; run this from the project it ran in.',
	]
}

const cost_transcript = {
	TRANSCRIPT_EXTENSION,
	project_slug,
	transcript_directory,
	list_sessions,
	tally,
	read_session,
	read_raw,
	missing_message,
}

export type { SessionFile, SessionUsage }
export { cost_transcript }
