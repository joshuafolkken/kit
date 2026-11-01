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
const ENV_ASSIGNMENT = /(?:^|\s)[A-Za-z_]\w*=/u
const ARGUMENT_QUOTES = /['"\\]/gu
const ARGUMENT_EXPANSION = /[*?{}[\]]/u

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

function is_gh_operation(args: Array<string>): boolean {
	if (args.some((argument) => argument.startsWith('--output'))) return false
	if (args[0] === 'api') return true

	return is_gh_action(args)
}

function is_operation(name: string, args: Array<string>): boolean {
	if (name === 'gh') return is_gh_operation(args)

	return name === 'josh' && OPERATIONS.test(canonical_command(args[0] ?? ''))
}

function is_read_or_operation(segment: string, name: string, args: Array<string>): boolean {
	if (READ_PROGRAMS.has(name)) return true
	if (name === 'rg') return args.every((argument) => !argument.startsWith('--pre'))
	if (name === 'git') return is_git_read(segment, args)

	return is_operation(name, args)
}

// A `josh` command outside the operations passes as a help request or on a declared read-only flag.
function program_refusal(segment: string, name: string, args: Array<string>): Refusal {
	if (is_read_or_operation(segment, name, args)) return undefined
	if (name === 'josh') return josh_read_only.refusal(args)

	return `\`${name}\` is neither a read-only program nor a consultation operation`
}

// A glob or brace expands into a read-only program's operands only, where no word it yields writes.
function expansion_refusal(segment: string, name: string): Refusal {
	if (READ_PROGRAMS.has(name)) return undefined

	return ARGUMENT_EXPANSION.test(time_shell.blanked(segment) ?? segment)
		? `glob or brace expansion in \`${name}\`, which is not a read-only program`
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

function command_refusal(segment: string, root: string): Refusal {
	const call = git_argv.program_of(segment)
	if (call === undefined) return undefined

	return expansion_refusal(segment, call.name) ?? call_refusal(segment, call, root)
}

function segment_refusal(segment: string, root: string): Refusal {
	const target = redirected_paths(segment).find((path) => unsafe_path(path, root))

	return target === undefined ? command_refusal(segment, root) : `redirect to \`${target}\``
}

// A single-quoted span expands nothing, so a finding quoting `code` in it is text, not a substitution.
function input_refusal(command: string): Refusal {
	const expanded = time_shell.literal_blanked(command)
	const rules: ReadonlyArray<readonly [string, boolean]> = [
		['an empty command', command.trim() === ''],
		['a heredoc', time_shell.has_heredoc(command)],
		['a command or process substitution', SUBSTITUTION.test(expanded)],
		['an environment assignment', ENV_ASSIGNMENT.test(expanded)],
		['a variable expansion', expanded.includes('$')],
	]

	return rules.find(([, is_matched]) => is_matched)?.[0]
}

// The rule the first unverified part of the command matched, named so a refusal can be diagnosed.
function refusal(command: string, root: string = process.cwd()): Refusal {
	const input = input_refusal(command)
	if (input !== undefined) return input

	return shell_segments
		.quote_aware_commands_of(command)
		.map((segment) => segment_refusal(segment, root))
		.find((rule) => rule !== undefined)
}

function is_unsafe(command: string, root: string = process.cwd()): boolean {
	return refusal(command, root) !== undefined
}

const implementation_shell = { is_unsafe, refusal }

export { implementation_shell }
