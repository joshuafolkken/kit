import { canonical_command } from '#scripts/josh/josh-aliases'
import { josh_read_only } from '#scripts/josh/josh-read-only'
import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { step_zero_notice } from './step-zero-notice'

// This is a pre-execution check of visible writes, not a shell sandbox. An interpreter body or
// dynamic destination cannot establish an operational-record-only write, so it fails closed.
const FILE_PROGRAMS: ReadonlySet<string> = new Set(['tee', 'touch', 'rm', 'truncate'])
const READ_PROGRAMS: ReadonlySet<string> = new Set([
	'cat',
	'grep',
	'head',
	'tail',
	'ls',
	'pwd',
	'echo',
	'printf',
	'true',
	'false',
	'wc',
	'diff',
	// Writes nothing itself; a write beside it is refused, as its target is no longer read off the root.
	'cd',
])
const GIT_READS: ReadonlySet<string> = new Set([
	'status',
	'diff',
	'show',
	'log',
	'ls-files',
	'rev-parse',
])
const OPERATIONS =
	/^(?:issue:|lane:|auto-ok:|epic(?::|$)|run:|doc:|review:|backlog:|report:|observations:|oracle:|plan:consumers$|cost$|delegate$|repo:party$|rule:list$|notify$|disposition$)/u
const GH_ACTIONS: ReadonlySet<string> = new Set([
	'view',
	'list',
	'status',
	'checks',
	'diff',
	'create',
	'edit',
	'comment',
	'close',
	'reopen',
])
const GIT_WRITE_FLAGS = /^-c|^--(?:config-env|exec-path|output|ext-diff|textconv)/u
const REDIRECT = /(?<![<>])(?:<>|>[>|&]?)(?![>&])/gu
const DESCRIPTOR = /^(?:\d+[+-]?|-)$/u
const QUOTES = /^['"]|['"]$/gu
const DYNAMIC_PATH = /[$`*?{}\\]/u
// Substitutions have their own execution and redirection scope; record text can use Edit/Write.
const SUBSTITUTION = /\$\(|`|[<>]\(/u
const ENV_ASSIGNMENT = /(?:^|[\s;&|(])[A-Za-z_]\w*=/u
// An assignment stands only before the program word, so a `gh api` field after `-f` / `-F` is not one.
const FIELD_VALUE = /(?<=\s(?:-[Ff]|--(?:raw-)?field)) \S+/gu
const LOOP_HEADER = /(?:^|[\s;&|(])for\s+([A-Za-z_]\w*)\s+in\s/gu
const VARIABLE_REFERENCE = /\$([A-Za-z_]\w*)/gu
const LOOP_BODY = /^\s*do\s+/u
const LOOP_KEYWORDS: ReadonlySet<string> = new Set(['for', 'do', 'done'])
const ARGUMENT_QUOTES = /['"\\]/gu
const ARGUMENT_EXPANSION = /[*?{}[\]]/u
// `find`'s actions that run a program or write a file; every other primary only selects and prints.
const FIND_ACTIONS = /^-(?:exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/u
// `-X` may close a cluster of short flags (`-iX DELETE`), as gh's flag parser reads it.
const NON_GET_METHOD = /(?:^|\s)(?:-[a-z]*X\s*|--method(?:=|\s+))(?!GET(?:\s|$))\S/iu
const PNPM_VIEW = /^\s*pnpm(?:\s+-\S+)*\s+view(?:\s|$)/u
const CD_WRITE = 'a write beside `cd`, whose target is not read off the repository root'

// The rule an unverified shell matched, or `undefined` for a visible read or record write.
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

function is_git_read(segment: string, args: Array<string>): boolean {
	return (
		GIT_READS.has(git_argv.parse(segment)?.subcommand ?? '') &&
		args.every((argument) => !GIT_WRITE_FLAGS.test(argument))
	)
}

function is_gh_action(args: Array<string>): boolean {
	return ['issue', 'pr'].includes(args[0] ?? '') && GH_ACTIONS.has(args[1] ?? '')
}

// A query or a field request (`-f`, a POST without `-X`) passes; an explicit method other than GET
// is a REST write the consultation scope leaves to `gh issue` / `gh pr`. `gh` takes the last of
// repeated method flags, so every one has to be GET.
function is_gh_api_allowed(args: Array<string>): boolean {
	return !NON_GET_METHOD.test(args.join(' '))
}

function is_gh_operation(args: Array<string>): boolean {
	if (args.some((argument) => argument.startsWith('--output'))) return false
	if (args[0] === 'api') return is_gh_api_allowed(args)

	return is_gh_action(args)
}

function is_operation(name: string, args: Array<string>): boolean {
	if (name === 'gh') return is_gh_operation(args)

	return name === 'josh' && OPERATIONS.test(canonical_command(args[0] ?? ''))
}

function is_rg_read(_segment: string, args: Array<string>): boolean {
	return args.every((argument) => !argument.startsWith('--pre'))
}

function is_find_read(_segment: string, args: Array<string>): boolean {
	return args.every((argument) => !FIND_ACTIONS.test(argument))
}

function is_npm_view(_segment: string, args: Array<string>): boolean {
	return args[0] === 'view'
}

// `pnpm` is a wrapper the program cut skips, so `pnpm view` is read off the segment's spelling.
function is_pnpm_view(segment: string): boolean {
	return PNPM_VIEW.test(segment)
}

// The programs whose arguments decide whether the call writes.
const ARGUMENT_READS: ReadonlyMap<string, (segment: string, args: Array<string>) => boolean> =
	new Map([
		['rg', is_rg_read],
		['git', is_git_read],
		['find', is_find_read],
		['npm', is_npm_view],
		['view', is_pnpm_view],
	])

function is_read_or_operation(segment: string, name: string, args: Array<string>): boolean {
	if (READ_PROGRAMS.has(name)) return true

	return ARGUMENT_READS.get(name)?.(segment, args) ?? is_operation(name, args)
}

// A `josh` command outside the operations passes as a help request or on a declared read-only flag.
function program_refusal(segment: string, name: string, args: Array<string>): Refusal {
	if (is_read_or_operation(segment, name, args)) return undefined
	if (name === 'josh') return josh_read_only.refusal(args)

	return `\`${name}\` is neither a read-only program nor a consultation operation`
}

// A glob, brace or loop variable expands into a read-only program's operands only, where no word it
// yields writes. A double-quoted loop variable still expands, so it is read off the literal blanking.
function expansion_refusal(segment: string, name: string): Refusal {
	if (READ_PROGRAMS.has(name)) return undefined

	const is_expanded =
		ARGUMENT_EXPANSION.test(time_shell.blanked(segment) ?? segment) ||
		time_shell.literal_blanked(segment).includes('$')

	return is_expanded
		? `glob, brace or variable expansion in \`${name}\`, which is not a read-only program`
		: undefined
}

function file_write_refusal(call: ProgramCall, root: string): Refusal {
	return write_args_are_unsafe(call.args, root) ? `\`${call.name}\` to a runtime path` : undefined
}

function call_refusal(segment: string, call: ProgramCall, root: string): Refusal {
	if (FILE_PROGRAMS.has(call.name)) return file_write_refusal(call, root)

	const args = call.args.map((argument) => argument.replaceAll(ARGUMENT_QUOTES, ''))

	return program_refusal(segment, call.name, args)
}

// A `for` header, a bare `do` and `done` run no program; a `do` body is judged as the command after
// it. A keyword is one only as the first word, so `npx done` is a program.
function command_refusal(segment: string, root: string): Refusal {
	const body = segment.replace(LOOP_BODY, '')
	if (LOOP_KEYWORDS.has(git_argv.words_of(body)[0] ?? '')) return undefined

	const call = git_argv.program_of(body)
	if (call === undefined) return undefined

	return expansion_refusal(body, call.name) ?? call_refusal(body, call, root)
}

function segment_refusal(segment: string, root: string): Refusal {
	const target = redirected_paths(segment).find((path) => unsafe_path(path, root))

	return target === undefined ? command_refusal(segment, root) : `redirect to \`${target}\``
}

function is_cd(segment: string): boolean {
	return git_argv.program_of(segment.replace(LOOP_BODY, ''))?.name === 'cd'
}

function is_write(segment: string): boolean {
	const name = git_argv.program_of(segment.replace(LOOP_BODY, ''))?.name ?? ''

	return FILE_PROGRAMS.has(name) || redirected_paths(segment).some((path) => path !== '/dev/null')
}

function segments_refusal(segments: Array<string>, root: string): Refusal {
	const is_moved = segments.some((segment) => is_cd(segment))
	if (is_moved && segments.some((segment) => is_write(segment))) return CD_WRITE

	return segments
		.map((segment) => segment_refusal(segment, root))
		.find((rule) => rule !== undefined)
}

// A `for` loop's variable takes a word of its visible list, so its reference is judged per segment.
function without_loop_references(expanded: string, plain: string): string {
	const names = new Set([...plain.matchAll(LOOP_HEADER)].map((match) => match[1]))

	return expanded.replaceAll(VARIABLE_REFERENCE, (reference, name: string) =>
		names.has(name) ? '' : reference,
	)
}

// A single-quoted span expands nothing, so a finding quoting `code` in it is text, not a substitution.
// An assignment or a loop header stands outside every quote, so those are read off the plain text.
function input_refusal(command: string): Refusal {
	const expanded = time_shell.literal_blanked(command)
	const plain = time_shell.blanked(command) ?? expanded
	const rules: ReadonlyArray<readonly [string, boolean]> = [
		['an empty command', command.trim() === ''],
		['a heredoc', time_shell.has_heredoc(command)],
		['a command or process substitution', SUBSTITUTION.test(expanded)],
		['an environment assignment', ENV_ASSIGNMENT.test(plain.replaceAll(FIELD_VALUE, ' '))],
		['a variable expansion', without_loop_references(expanded, plain).includes('$')],
	]

	return rules.find(([, is_matched]) => is_matched)?.[0]
}

// The rule the first unverified part of the command matched, named so a refusal can be diagnosed.
function refusal(command: string, root: string = process.cwd()): Refusal {
	const input = input_refusal(command)
	if (input !== undefined) return input

	return segments_refusal(shell_segments.quote_aware_commands_of(command), root)
}

function is_unsafe(command: string, root: string = process.cwd()): boolean {
	return refusal(command, root) !== undefined
}

const implementation_shell = { is_unsafe, refusal }

export { implementation_shell }
