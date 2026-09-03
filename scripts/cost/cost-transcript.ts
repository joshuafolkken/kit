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

// Where a delegated unit's transcript is written (joshuafolkken/kit#1285).
//
// `epicrun` and `queue` run each child in a delegated unit, and `gate-fix` / `survey` delegate one
// step of a run. **None of that lands beside the session's own transcript**: the unit writes to
// `<session-id>/subagents/agent-<agentId>.jsonl`, a subdirectory of the session that delegated it.
// A reader that lists only `*.jsonl` directly under the project slug therefore sees the parent
// waiting and none of the work — measured on epic #1272, whose four merged children reported as
// "CI wait only" with not one minute of implementation, gate or review attributed to any of them.
const UNIT_DIRECTORY = 'subagents'
// A unit's id is qualified by the session that delegated it, because an agent id alone reads as a
// session of its own — and `--session` has to be able to name one unambiguously.
const UNIT_ID_SEPARATOR = '/'

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
	// Whether this transcript is a delegated unit's rather than a session's own. Carried on the file
	// because only the discovery knows where it was found, and two readers need the answer: the time
	// side, which must not count a unit's work twice against the parent's wait for it, and the cost
	// side, whose no-argument scope means "the session that just finished" rather than one of its
	// units.
	is_delegated: boolean
}

function to_session_file(
	full_path: string,
	session_id: string,
	is_delegated: boolean,
): SessionFile | undefined {
	try {
		return { session_id, path: full_path, modified_ms: statSync(full_path).mtimeMs, is_delegated }
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

function is_transcript(name: string): boolean {
	return name.endsWith(TRANSCRIPT_EXTENSION)
}

function without_extension(name: string): string {
	return name.slice(0, -TRANSCRIPT_EXTENSION.length)
}

function own_files(directory: string, names: ReadonlyArray<string>): Array<SessionFile> {
	return names
		.filter((name) => is_transcript(name))
		.map((name) => to_session_file(path.join(directory, name), without_extension(name), false))
		.filter((file): file is SessionFile => file !== undefined)
}

// Where one session's delegated units are written. Exported because the layout is this module's
// knowledge: a caller that rebuilds the path by hand is a second statement of where a unit lives,
// free to disagree with the one the discovery below walks.
function unit_directory(directory: string, session_id: string): string {
	return path.join(directory, session_id, UNIT_DIRECTORY)
}

// The units one session delegated. An entry with no `subagents/` yields nothing rather than
// throwing, so a session that never delegated — and the `memory/` and `tool-results/` directories
// Claude Code keeps beside the transcripts — cost one failed read each.
function unit_files(directory: string, session_name: string): Array<SessionFile> {
	const found = unit_directory(directory, session_name)

	return read_directory(found)
		.filter((name) => is_transcript(name))
		.map((name) =>
			to_session_file(
				path.join(found, name),
				`${session_name}${UNIT_ID_SEPARATOR}${without_extension(name)}`,
				true,
			),
		)
		.filter((file): file is SessionFile => file !== undefined)
}

// Newest first, so "the run that just finished" is the default with no argument.
//
// **A session's own transcript and its delegated units' are both listed.** A run that delegated
// wrote most of its work to the units and none of it to the file named after the session, so
// listing only the session files answers such a run with the parent's wait alone. The candidates
// for a unit directory are the entries that are *not* transcripts, which is why nothing here calls
// `statSync` to ask what an entry is: the answer that matters is whether a `subagents` inside it
// can be read.
function list_sessions(directory: string): Array<SessionFile> {
	const names = read_directory(directory)
	const units = names
		.filter((name) => !is_transcript(name))
		.flatMap((name) => unit_files(directory, name))

	return [...own_files(directory, names), ...units].toSorted(
		(left, right) => right.modified_ms - left.modified_ms,
	)
}

// The session a transcript belongs with: itself, or — for a delegated unit — the session that
// delegated it, which is the half of the unit's qualified id in front of the separator.
//
// **A reader that resolves an overlap needs this, not just `is_delegated`.** A unit's work overlaps
// the wait of the session that delegated it and nothing else: two unrelated sessions attributed to
// the same issue can run at the same wall clock — a batch in the background while someone works
// interactively — and treating every unit as covering every session would delete real work.
function owning_session_id(file: SessionFile): string {
	const [owner] = file.session_id.split(UNIT_ID_SEPARATOR)

	return owner ?? file.session_id
}

// Which of a listing is "the run that just finished": the newest transcript that is a session's own
// rather than one of its delegated units (joshuafolkken/kit#1285).
//
// **A delegated unit is part of a run, not a run of its own**, and it writes the newer file whenever
// a session delegates — the parent is waiting while the unit works. Taking the head of the listing
// would therefore answer a no-argument `josh cost` with one child of the batch.
//
// **Zero when nothing qualifies**, which reads as "the newest transcript, of whatever kind". That is
// the right answer in both states it can arise from: a listing narrowed by
// `--session <parent>/agent-<id>` holds one unit and nothing else, and a whole listing holding only
// units is a project whose session files were pruned while their `subagents/` survived. In
// neither is refusing better — there is no session to prefer, a transcript really was found, and the
// scope line names it `<session-id>/agent-<agentId>`, so the report says which kind it read.
function latest_own_index(files: ReadonlyArray<SessionFile>): number {
	const index = files.findIndex((file) => !file.is_delegated)

	return index === -1 ? 0 : index
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
	unit_directory,
	list_sessions,
	owning_session_id,
	latest_own_index,
	tally,
	read_session,
	read_raw,
	missing_message,
}

export type { SessionFile, SessionUsage }
export { cost_transcript }
