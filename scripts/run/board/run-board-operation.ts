import path from 'node:path'
import { token_shape } from '#scripts/lib/token-shape'
import { transcript_record, type TranscriptRecord } from '#scripts/lib/transcript-record'
import { z } from 'zod'

// The newest thing a session did, read off the end of its log — a lane child's dispatch log, the
// parent's transcript or the watcher's log, all one JSON object a line with the tool calls of an
// `assistant` line under `message.content`. **Only what a machine decided is kept**: the tool's name
// and what it was pointed at. The call's `description` is the session's own prose, in the session's
// language, and the board is written in English.

interface Operation {
	// The tool's name: `Bash`, `Edit`, `Read`, …
	kind: string
	// The head of the command, or the file's path; `undefined` for a tool pointed at neither.
	target: string | undefined
	at_ms: number
}

// A command is cut here, so a long argument — or a value passed in one — is not drawn.
const TARGET_LIMIT = 40
const CUT_MARK = '…'
const TOOL_USE = 'tool_use'
// A line that holds no call is never parsed: one can be tens of thousands of characters long.
const TOOL_USE_MARK = `"${TOOL_USE}"`
const NEWLINE = '\n'
// One variable set ahead of the command, with what parts it from the command: it carries a value,
// never what the command does. The value is read as the shell reads one word — a quoted stretch with
// its escapes and line breaks, a command run for its output, an escaped character, a plain one.
const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/su
const SUBSTITUTED = /\$\((?:[^()]|\([^()]*\))*\)|`[^`]*`/su
const PLAIN = /\\.|[^\s"'`;&|()\\]/su
const VALUE = `(?:${QUOTED.source}|${SUBSTITUTED.source}|${PLAIN.source})*`
const ASSIGNMENT = new RegExp(String.raw`^\w+=${VALUE}(?:\s*(?:&&|;)\s*|\s+|$)`, 'su')
// A variable still at the head once every readable one is gone: its value could not be read as one.
const UNREAD_ASSIGNMENT = /^\w+=/u
const SPACES = /\s+/gu
// The printable ASCII a target begins with: what follows may be the session's own language.
const ASCII_HEAD = /^[ -~]*/u

// An input that is no object reads as one pointed at nothing.
const INPUT_SCHEMA = z
	.looseObject({ command: z.string().optional(), file_path: z.string().optional() })
	.catch({})

type Input = z.infer<typeof INPUT_SCHEMA>

function ascii_head(text: string): string {
	return (ASCII_HEAD.exec(text)?.[0] ?? '').trim()
}

function cut(text: string): string {
	return text.length > TARGET_LIMIT ? `${text.slice(0, TARGET_LIMIT)}${CUT_MARK}` : text
}

// The command without every variable set ahead of it, one at a time.
function without_assignments(command: string): string {
	const rest = command.replace(ASSIGNMENT, '')

	return rest === command ? command : without_assignments(rest)
}

// The first line of what the command runs, cut to the limit. A command whose variable cannot be read
// to its end is drawn as nothing: a part of the value would stand where the command should. A
// credential later in the line is redacted before the cut, which would leave a head no shape matches.
function command_target(command: string): string {
	const [first = ''] = without_assignments(command.trim()).split(NEWLINE)
	if (UNREAD_ASSIGNMENT.test(first)) return ''

	return cut(ascii_head(token_shape.redact(first).replaceAll(SPACES, ' ')))
}

// The path from `root` down; a file outside it is drawn by its name alone, never by where it is.
function path_target(file_path: string, root: string | undefined): string {
	const relative = root === undefined ? undefined : path.relative(root, file_path)
	const is_inside = relative !== undefined && !relative.startsWith('..') && relative !== ''

	return ascii_head(is_inside ? relative : path.basename(file_path))
}

function shown(target: string): string | undefined {
	return target === '' ? undefined : target
}

function target_of(input: Input, root: string | undefined): string | undefined {
	if (input.command !== undefined) return shown(command_target(input.command))

	return input.file_path === undefined ? undefined : shown(path_target(input.file_path, root))
}

// The last call a line holds, `undefined` for an undated line or one holding none. A call names its
// tool; every other block of a line — its text, its thinking — is not one.
function record_operation(
	record: TranscriptRecord,
	root: string | undefined,
): Operation | undefined {
	const call = transcript_record.tool_calls_of(record).at(-1)
	const at_ms = Date.parse(record.timestamp ?? '')

	if (call === undefined || Number.isNaN(at_ms)) return undefined

	return { kind: call.name, target: target_of(INPUT_SCHEMA.parse(call.input), root), at_ms }
}

// The same, `undefined` too for a line that is cut or is not JSON.
function line_operation(line: string, root: string | undefined): Operation | undefined {
	const record = transcript_record.parse(line)

	return record === undefined ? undefined : record_operation(record, root)
}

// The newest operation in `tail` — the end of a log, whose first line is usually cut mid-way and so
// reads as no call. `root` is the checkout the session works in, which its paths are drawn from.
function latest_of(tail: string, root?: string): Operation | undefined {
	const lines = tail.split(NEWLINE).filter((line) => line.includes(TOOL_USE_MARK))

	for (const line of lines.toReversed()) {
		const operation = line_operation(line, root)

		if (operation !== undefined) return operation
	}

	return undefined
}

// The operation as the board writes it: `Bash pnpm josh test:related`, or the tool alone.
function words_of(operation: Operation): string {
	return operation.target === undefined ? operation.kind : `${operation.kind} ${operation.target}`
}

const run_board_operation = { TARGET_LIMIT, latest_of, words_of }

export { run_board_operation }
export type { Operation }
