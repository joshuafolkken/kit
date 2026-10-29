import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { shell_segments } from './shell-segments'

// Which shell commands are broad investigation (joshuafolkken/kit#5351): a search over a tree, a
// read past the line cap, an aggregation script. A narrow check — a bounded range of one file, a
// search of one file — is not, so a consultation main line can still verify a cited line itself.

// **The cap on one narrow read**, shared by `Read`'s `limit` and the shell readers' ranges.
const READ_LINE_CAP = 200
const DEFAULT_HEAD_LINES = 10
const SHORT_FLAGS = /^-[a-zA-Z]+$/u
const RECURSIVE_LETTERS = /[rR]/u
const LONG_RECURSIVE: ReadonlySet<string> = new Set(['--recursive', '--dereference-recursive'])
const SED_RANGE = /^(?<first>\d+),(?<last>\d+)p$/u
const SED_TO_END = /^\d+,\$p$/u
const LINE_COUNT_PREFIXES = ['--lines=', '-n', '-']
const DIGITS = /^\d+$/u
const FROM_LINE = /^\+\d+$/u
const QUOTES = /^['"]|['"]$/gu
const WHITESPACE = /\s+/u
const ASSIGNMENT = /^\w+=/u
const ALWAYS_BROAD: ReadonlySet<string> = new Set(['find', 'for', 'node', 'python', 'python3'])
const ANALYSIS_PREFIX = 'josh cost:'
const FLAG_PREFIX = '-'
const HEREDOC = '<<'

// `is_piped`: the command is a later stage of a pipeline, so a reader naming no file reads the pipe.
type CommandTest = (
	operands: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
	is_piped: boolean,
) => boolean

function resolved(file: string): string {
	return path.resolve(process.env['JOSH_HOOK_CWD'] ?? process.cwd(), file)
}

function is_file(file: string): boolean {
	return statSync(resolved(file), { throwIfNoEntry: false })?.isFile() === true
}

function is_directory(file: string): boolean {
	return statSync(resolved(file), { throwIfNoEntry: false })?.isDirectory() === true
}

function line_count(file: string): number {
	return is_file(file) ? readFileSync(resolved(file), 'utf8').split('\n').length : 0
}

function is_recursive_flag(flag: string): boolean {
	return LONG_RECURSIVE.has(flag) || (SHORT_FLAGS.test(flag) && RECURSIVE_LETTERS.test(flag))
}

// A search names one file at most past its pattern; any directory is a tree.
function searches_tree(operands: ReadonlyArray<string>, flags: ReadonlyArray<string>): boolean {
	if (flags.some((flag) => is_recursive_flag(flag))) return true

	return operands.slice(1).some((operand) => is_directory(operand))
}

// `rg` recurses by default, so naming no path at all searches the tree — unless it reads a pipe.
function rg_searches_tree(
	operands: ReadonlyArray<string>,
	_flags: ReadonlyArray<string>,
	is_piped: boolean,
): boolean {
	const paths = operands.slice(1)
	if (paths.length === 0) return !is_piped

	return paths.some((operand) => !is_file(operand))
}

function sed_span(script: string): number {
	const groups = SED_RANGE.exec(script)?.groups

	return groups === undefined ? 0 : Number(groups['last']) - Number(groups['first']) + 1
}

// Only a `-n` print range is a read; one past the cap, or to the end of the file, is broad.
function sed_reads_past_cap(
	operands: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
): boolean {
	if (!flags.includes('-n')) return false
	const [script = ''] = operands

	return SED_TO_END.test(script) || sed_span(script) > READ_LINE_CAP
}

function number_of(word = ''): number | undefined {
	return DIGITS.test(word) ? Number(word) : undefined
}

// `-nN`, `-N` or `--lines=N`; `undefined` for a word that is none of them.
function count_of(word: string): number | undefined {
	const prefix = LINE_COUNT_PREFIXES.find((candidate) => word.startsWith(candidate))
	const rest = prefix === undefined ? '' : word.slice(prefix.length)

	return number_of(rest)
}

// A bare `-n` takes its count as a word of its own: the first operand, wherever the flags sit.
function counted_lines(operands: ReadonlyArray<string>, flags: ReadonlyArray<string>): number {
	const inline = flags.map((flag) => count_of(flag)).find((count) => count !== undefined)
	const separate = flags.includes('-n') ? number_of(operands[0]) : undefined

	return inline ?? separate ?? DEFAULT_HEAD_LINES
}

// `head` / `tail` read past the cap by count, or to the end from a `+N` start.
function ends_past_cap(operands: ReadonlyArray<string>, flags: ReadonlyArray<string>): boolean {
	if (operands.some((word) => FROM_LINE.test(word))) return true

	return counted_lines(operands, flags) > READ_LINE_CAP
}

function cat_reads_past_cap(operands: ReadonlyArray<string>): boolean {
	return operands.some((operand) => line_count(operand) > READ_LINE_CAP)
}

const COMMAND_TESTS: ReadonlyMap<string, CommandTest> = new Map([
	['grep', searches_tree],
	['rg', rg_searches_tree],
	['sed', sed_reads_past_cap],
	['head', ends_past_cap],
	['tail', ends_past_cap],
	['cat', cat_reads_past_cap],
])

function words_of(segment: string): Array<string> {
	const words = segment.split(WHITESPACE).map((word) => word.replaceAll(QUOTES, ''))
	const start = words.findIndex((word) => !ASSIGNMENT.test(word))

	return start === -1 ? [] : words.slice(start)
}

// A reader whose input is a heredoc reads nothing from disk.
function reads_past_cap(
	segment: string,
	name: string,
	rest: ReadonlyArray<string>,
	is_piped: boolean,
): boolean {
	const test = COMMAND_TESTS.get(name)
	if (test === undefined || segment.includes(HEREDOC)) return false
	const flags = rest.filter((word) => word.startsWith(FLAG_PREFIX))
	const operands = rest.filter((word) => !word.startsWith(FLAG_PREFIX))

	return test(operands, flags, is_piped)
}

function is_broad_segment(segment: string, is_piped: boolean): boolean {
	if (time_shell.josh_command_of(segment).startsWith(ANALYSIS_PREFIX)) return true
	const [name = '', ...rest] = words_of(segment)

	return ALWAYS_BROAD.has(name) || reads_past_cap(segment, name, rest, is_piped)
}

// Every stage past a pipeline's first reads the stage before it.
function is_broad_pipeline(pipeline: string): boolean {
	return shell_segments
		.quote_aware_commands_of(pipeline)
		.some((stage, index) => is_broad_segment(stage, index > 0))
}

function is_broad_command(command: string): boolean {
	return shell_segments.segments_of(command).some((pipeline) => is_broad_pipeline(pipeline))
}

const broad_investigation_shell = { READ_LINE_CAP, is_broad_command, is_file }

export { broad_investigation_shell }
