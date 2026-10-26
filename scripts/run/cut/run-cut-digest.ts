import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { own_session } from '#scripts/cost-runtime/own-session'
import { duplicate_reads } from '#scripts/delegation/duplicate-read-guard'
import { json_value } from '#scripts/lib/json-value'
import { transcript_record, type TranscriptRecord } from '#scripts/lib/transcript-record'
import { time_spans } from '#scripts/time-runtime/time-spans'
import { z } from 'zod'

// What the cut session already read and decided, derived from its own transcript so the resumed
// process does not spend minutes re-reading to rebuild it (joshuafolkken/kit#5040).
//
// **Derived, not written by the agent.** The reads are tool calls and the decisions are the
// `Auto-decided:` lines the session already logs (`CLAUDE.md` → "Decision autonomy") — in its reply,
// or in the Issue comment a tool call posts — so the cut takes both from the transcript: nothing to
// forget, and no handoff key the refusal has to spell out.

interface SessionDigest {
	read: ReadonlyArray<string>
	decisions: ReadonlyArray<string>
}

const session_digest_schema = z.object({
	read: z.array(z.string()),
	decisions: z.array(z.string()),
})

// The newest entries are kept: the record has a byte bound, and the last reads are the ones the
// resumed work continues from.
const MAX_READ_ENTRIES = 40
const MAX_DECISIONS = 12
const MAX_DECISION_CHARS = 240
const DECISION_PREFIX = 'Auto-decided:'
// A logged decision wherever it starts a line or follows a quote or `body=`; the space after the colon
// keeps out the bare prefix a source file spells.
const DECISION_LINE = /(?:^|[\s'"=])(Auto-decided: [^\n]+)/gu
// The quote closing a `body='…'` argument.
const TRAILING_QUOTES = /['"]$/u
const ASSISTANT = 'assistant'
const READ_LABEL = 'Already read before the cut — re-read only the lines you need'
const DECISIONS_LABEL = 'Decided before the cut — do not reopen'

function shown_path(target: string, cwd: string): string {
	const relative = path.relative(cwd, path.resolve(cwd, target))

	return relative.startsWith('..') ? target : relative
}

function newest_unique(entries: ReadonlyArray<string>, limit: number): Array<string> {
	const unique = [...new Set(entries.toReversed())].toReversed()

	return unique.slice(-limit)
}

function read_files_of(text: string, cwd: string): Array<string> {
	const reads = time_spans
		.parse_timeline(text)
		.spans.filter((span) => duplicate_reads.is_successful_read(span))
		.flatMap((span) => span.targets.map((target) => shown_path(target, cwd)))

	return newest_unique(reads, MAX_READ_ENTRIES)
}

// Where a tool call carries an Issue comment: the Bash command posting it, or the body file a `Write`
// prepared for it. An `Edit`'s strings are source text, so they are not read.
const COMMENT_INPUT_KEYS = ['command', 'content']

function input_strings(input: unknown): Array<string> {
	if (!json_value.is_record(input)) return []

	return COMMENT_INPUT_KEYS.map((key) => input[key]).filter((value) => typeof value === 'string')
}

// What the session wrote: its reply text and the inputs of its tool calls, where an Issue workflow's
// decision comment travels.
function assistant_texts(record: TranscriptRecord | undefined): Array<string> {
	if (record?.type !== ASSISTANT) return []

	return transcript_record
		.blocks_of(record)
		.flatMap((block) => [block.text ?? '', ...input_strings(block.input)])
}

function decisions_of(text: string): Array<string> {
	const decisions = text
		.split('\n')
		.flatMap((line) => assistant_texts(transcript_record.parse(line)))
		.flatMap((written) => [...written.matchAll(DECISION_LINE)].map((match) => match[1] ?? ''))
		.map((line) => line.replace(TRAILING_QUOTES, '').slice(0, MAX_DECISION_CHARS))

	return newest_unique(decisions, MAX_DECISIONS)
}

function digest_of(text: string, cwd: string): SessionDigest {
	return { read: read_files_of(text, cwd), decisions: decisions_of(text) }
}

// The running session's own transcript, or `undefined`. Only a session that names itself is read: the
// newest-file fallback could pick another session filed under the checkout (a Codex lane's reviewer).
function own_transcript(cwd: string, environment: NodeJS.ProcessEnv): string | undefined {
	if (own_session.session_id_of(environment) === undefined) return undefined

	const files = cost_transcript.list_sessions_across(cost_transcript.transcript_directories(cwd))
	const selection = own_session.select_own_session(files, environment)
	if (selection.kind === 'absent') return undefined

	const file = files[selection.index]

	return file === undefined ? undefined : cost_transcript.read_optional(file)
}

// The running session's own digest, or `undefined` when its transcript cannot be found — a cut is
// never refused for want of one.
function own_digest(
	cwd: string = process.cwd(),
	environment: NodeJS.ProcessEnv = process.env,
): SessionDigest | undefined {
	const text = own_transcript(cwd, environment)

	return text === undefined ? undefined : digest_of(text, cwd)
}

function describe_list(label: string, entries: ReadonlyArray<string>): Array<string> {
	if (entries.length === 0) return []

	const bullets = entries.map((entry) => `  - ${entry}`).join('\n')

	return [`${label}:\n${bullets}`]
}

// The block the resume prints; nothing for a digest with neither list.
function describe_digest(digest: SessionDigest | undefined): string | undefined {
	if (digest === undefined) return undefined

	const blocks = [
		...describe_list(READ_LABEL, digest.read),
		...describe_list(DECISIONS_LABEL, digest.decisions),
	]

	return blocks.length === 0 ? undefined : blocks.join('\n\n')
}

const run_cut_digest = {
	DECISION_PREFIX,
	describe_digest,
	digest_of,
	own_digest,
	session_digest_schema,
}

export type { SessionDigest }
export { run_cut_digest }
