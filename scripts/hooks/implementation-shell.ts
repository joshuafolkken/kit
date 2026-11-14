import path from 'node:path'
import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { implementation_shell_deny } from './implementation-shell-deny'
import { implementation_shell_nested } from './implementation-shell-nested'
import { step_zero_notice } from './step-zero-notice'

// A consultation scope's pre-execution check (joshuafolkken/kit#6586): a shell runs unless it makes a
// change no later check takes back. A runtime file a call changes and names is restored after it
// (`bash-revert.ts`; one it does not name is only reported, #7495); a visible write to one is still
// refused here, as is every call
// `implementation-shell-deny.ts` names — in a segment, a substitution or a program another one launches.
const FILE_PROGRAMS: ReadonlySet<string> = new Set(['tee', 'touch', 'rm', 'truncate'])
// The other programs that write the files their arguments name. `bash-revert.ts` restores only the
// session's own checkout, so one aimed at a runtime file outside it is refused. A copy writes only its
// last argument unless `-t` names the directory; `sed` / `perl` write only in place; an `of=` value is
// a path.
const COPY_PROGRAMS: ReadonlySet<string> = new Set(['cp', 'ln', 'install', 'rsync', 'scp'])
const MOVE_PROGRAMS: ReadonlySet<string> = new Set([
	...COPY_PROGRAMS,
	'mv',
	'dd',
	'patch',
	'tar',
	'unzip',
])
const TARGET_DIRECTORY = /^-(?:[A-Za-z]*t|-target-directory)/u
const IN_PLACE_PROGRAMS: ReadonlySet<string> = new Set(['sed', 'perl'])
const IN_PLACE = /^-(?:[A-Za-z]*i|-in-place)/u
const REDIRECT = /(?<![<>])(?:<>|>[>|&]?)(?![>&])/gu
const DESCRIPTOR = /^(?:\d+[+-]?|-)$/u
const QUOTES = /^['"]|['"]$/gu
const DYNAMIC_PATH = /[$`*?{}\\]/u
// A compound command's opening words and closing brackets, so its body is judged as the command it
// runs: `if x; then git push; fi` and `(cd x && git push)` launch `git push`.
const COMPOUND_HEAD = /^\s*(?:[({!]\s*|(?:if|then|else|elif|while|until|do)\s+)+/u
const COMPOUND_CLOSERS = new Set([')', '}', ' ', '\t', '\n'])
const KEYWORDS: ReadonlySet<string> = new Set([
	'for',
	'do',
	'done',
	'then',
	'else',
	'fi',
	'case',
	'select',
	'function',
	'esac',
])
// The shared cut reads a `case` arm and a `{` function body as segments of their own
// (joshuafolkken/kit#7340). What it leaves unread — a function head with another body, or an arm
// pattern still on its segment — is refused rather than guessed.
const FUNCTION_START = /^(?:function\s|[\w.:-]+\s*\(\s*\))/u
// `body_of` has stripped the head's closing `)` and trailing blanks with the other closers.
const FUNCTION_HEAD = /^(?:function\s+)?[\w.:-]+(?:\s*\()?$/u
// An arm's command may touch its `)` (`b)git push`), so a `)` anywhere in the first word, outside an
// expansion, is a pattern.
const UNREAD_ARMS: ReadonlyArray<RegExp> = [/^case\s[\s\S]*\)/u, /^[^\s$`]*\)/u]
const ARGUMENT_QUOTES = /['"\\]/gu
const TIME_PROGRAM = /(?:^|\/)time$/u
const TIME_WRITE = /^-(?:[A-Za-z]*o|-o)/u
const CD_WRITE = 'a write beside `cd`, whose target is not read off the repository root'
const STDIN_SHELL = 'a shell running the commands its standard input spells, which may be any write'

// The irreversible operation a shell matched, or `undefined` when it runs.
type Refusal = string | undefined

function unsafe_path(target: string, root: string): boolean {
	const file_path = target.replaceAll(QUOTES, '')

	if (file_path === '/dev/null') return false

	return DYNAMIC_PATH.test(file_path) || step_zero_notice.is_runtime_file(file_path, root, true)
}

function redirected_paths(command: string): Array<string> {
	const plain = time_shell.blanked(command)
	if (plain === undefined) return []

	return [...plain.matchAll(REDIRECT)].map((match) => {
		const following = command.slice(match.index + match[0].length)
		const target = git_argv.words_of(following)[0] ?? '$unknown'

		return match[0].endsWith('>&') && DESCRIPTOR.test(target) ? '/dev/null' : target
	})
}

function write_args_are_unsafe(args: Array<string>, root: string): boolean {
	return args
		.filter((argument) => argument !== '-a')
		.some((argument) => unsafe_path(argument, root))
}

function plain_argument(word: string): string | undefined {
	if (/^'[^']*'$/u.test(word) || /^"[^"\\$`]*"$/u.test(word)) return word.slice(1, -1)
	if (/['"\\$`]/u.test(word)) return undefined

	return word
}

// `program_of` skips time as a wrapper. Its own output destination still needs checking before
// the wrapped command is judged; timing a call must not admit a write through `time -o`.
function wrapper_writes(segment: string): boolean {
	const words = git_argv.words_of(segment)
	const index = words.findIndex((word) => TIME_PROGRAM.test(word))
	if (index === -1) return false

	const call = git_argv.program_of(segment)
	const program_index = words.length - (call?.args.length ?? 0) - 1

	return words.slice(index + 1, program_index).some((word) => {
		const argument = plain_argument(word)

		return argument === undefined || TIME_WRITE.test(argument)
	})
}

function is_copy_to_last(call: ProgramCall): boolean {
	if (!COPY_PROGRAMS.has(call.name)) return false

	return call.args.every((argument) => !TARGET_DIRECTORY.test(argument))
}

function written_args(call: ProgramCall): Array<string> {
	const written = is_copy_to_last(call) ? call.args.slice(-1) : call.args

	return written.map((argument) => argument.slice(argument.indexOf('=') + 1))
}

function is_outside(target: string, root: string): boolean {
	const relative = path.relative(root, path.resolve(root, target.replaceAll(QUOTES, '')))

	return relative.startsWith('..') || path.isAbsolute(relative)
}

function file_write_refusal(call: ProgramCall, root: string): Refusal {
	return write_args_are_unsafe(call.args, root) ? `\`${call.name}\` to a runtime path` : undefined
}

function writes_elsewhere(call: ProgramCall): boolean {
	if (MOVE_PROGRAMS.has(call.name)) return true

	return IN_PLACE_PROGRAMS.has(call.name) && call.args.some((argument) => IN_PLACE.test(argument))
}

function outside_write_refusal(call: ProgramCall, root: string): Refusal {
	if (!writes_elsewhere(call)) return undefined

	const target = written_args(call).find(
		(argument) => is_outside(argument, root) && unsafe_path(argument, root),
	)

	return target === undefined
		? undefined
		: `\`${call.name}\` to a runtime path outside this checkout`
}

function call_refusal(segment: string, call: ProgramCall, root: string): Refusal {
	if (FILE_PROGRAMS.has(call.name)) return file_write_refusal(call, root)
	if (implementation_shell_nested.reads_stdin(call)) return STDIN_SHELL

	const args = call.args.map((argument) => argument.replaceAll(ARGUMENT_QUOTES, ''))
	const name = call.name.replaceAll(ARGUMENT_QUOTES, '')
	// `pnpm install` reaches here as the program `install`, so a writer still meets the deny-list.
	const outside = outside_write_refusal(call, root)

	return outside ?? implementation_shell_deny.refusal(segment, { name, args })
}

function body_of(segment: string): string {
	const body = segment.replace(COMPOUND_HEAD, '')
	let end = body.length

	while (end > 0 && COMPOUND_CLOSERS.has(body.charAt(end - 1))) end -= 1

	return body.slice(0, end)
}

// The program a segment launches, read off its compound body. A `for` header and a bare keyword run
// none — a keyword is one only as the first word, so `npx done` is a program.
function call_of(segment: string): ProgramCall | undefined {
	const body = body_of(segment)
	if (KEYWORDS.has(git_argv.words_of(body)[0] ?? '')) return undefined

	return git_argv.program_of(body)
}

function command_refusal(segment: string, root: string): Refusal {
	const call = call_of(segment)

	return call === undefined ? undefined : call_refusal(body_of(segment), call, root)
}

function is_unread_body(body: string): boolean {
	if (FUNCTION_START.test(body)) return !FUNCTION_HEAD.test(body)

	return UNREAD_ARMS.some((pattern) => pattern.test(body))
}

function segment_refusal(segment: string, root: string): Refusal {
	if (wrapper_writes(segment)) return 'a time output file'
	if (is_unread_body(body_of(segment))) return 'a `case` arm or function body'

	const target = redirected_paths(segment).find((redirected) => unsafe_path(redirected, root))

	return target === undefined ? command_refusal(segment, root) : `redirect to \`${target}\``
}

function is_cd(segment: string): boolean {
	return call_of(segment)?.name === 'cd'
}

function is_write(segment: string): boolean {
	const call = call_of(segment)
	if (call !== undefined && (FILE_PROGRAMS.has(call.name) || writes_elsewhere(call))) return true

	return redirected_paths(segment).some((redirected) => redirected !== '/dev/null')
}

function segments_refusal(segments: Array<string>, root: string): Refusal {
	const is_moved = segments.some((segment) => is_cd(segment))
	if (is_moved && segments.some((segment) => is_write(segment))) return CD_WRITE

	return segments
		.map((segment) => segment_refusal(segment, root))
		.find((rule) => rule !== undefined)
}

function nested_lines(line: string, segments: ReadonlyArray<string>): Array<string> {
	const launched = segments.flatMap((segment) => {
		const call = call_of(segment)

		return call === undefined ? [] : implementation_shell_nested.call_commands(call)
	})

	return [...implementation_shell_nested.substitution_bodies(line), ...launched]
}

// Every segment the line runs, a nested command's included. A nested line is a part of the one
// holding it, so the walk ends.
function segments_of(command: string): Array<string> {
	const segments: Array<string> = []
	const pending = [command]
	let line = pending.pop()

	while (line !== undefined) {
		const cut = shell_segments.quote_aware_commands_of(line)

		segments.push(...cut)
		pending.push(...nested_lines(line, cut))
		line = pending.pop()
	}

	return segments
}

// A heredoc's body is not a command the segment cut can read, so it is refused rather than guessed.
function input_refusal(command: string): Refusal {
	if (command.trim() === '') return 'an empty command'

	return time_shell.has_heredoc(command) ? 'a heredoc' : undefined
}

// The irreversible operation the first refused part of the command is, named so a refusal can be
// diagnosed.
function refusal(command: string, root: string = process.cwd()): Refusal {
	return input_refusal(command) ?? segments_refusal(segments_of(command), root)
}

function is_unsafe(command: string, root: string = process.cwd()): boolean {
	return refusal(command, root) !== undefined
}

const implementation_shell = { is_unsafe, refusal }

export { implementation_shell }
