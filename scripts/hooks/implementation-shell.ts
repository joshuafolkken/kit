import { git_argv } from '#scripts/rules/git-argv'
import { shell_segments } from '#scripts/rules/shell-segments'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { step_zero_notice } from './step-zero-notice'

// This is a pre-execution check of visible writes, not a shell sandbox. An interpreter body or
// dynamic destination cannot establish an operational-record-only write, so it fails closed.
const FILE_PROGRAMS: ReadonlySet<string> = new Set(['tee', 'touch', 'rm', 'truncate'])
const READ_PROGRAMS: ReadonlySet<string> = new Set([
	'cat',
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

	return name === 'josh' && OPERATIONS.test(args[0] ?? '')
}

function is_read_or_operation(segment: string, name: string, args: Array<string>): boolean {
	if (READ_PROGRAMS.has(name)) return true
	if (name === 'rg') return args.every((argument) => !argument.startsWith('--pre'))
	if (name === 'git') return is_git_read(segment, args)

	return is_operation(name, args)
}

function command_is_unsafe(segment: string, root: string): boolean {
	const call = git_argv.program_of(segment)
	if (call === undefined) return false
	if (FILE_PROGRAMS.has(call.name)) return write_args_are_unsafe(call.args, root)

	const args = call.args.map((argument) => argument.replaceAll(ARGUMENT_QUOTES, ''))

	return !is_read_or_operation(segment, call.name, args)
}

function segment_is_unsafe(segment: string, root: string): boolean {
	return (
		redirected_paths(segment).some((target) => unsafe_path(target, root)) ||
		command_is_unsafe(segment, root)
	)
}

// A single-quoted span expands nothing, so a finding quoting `code` in it is text, not a substitution.
function input_is_unverified(command: string): boolean {
	const expanded = time_shell.literal_blanked(command)

	return (
		command.trim() === '' ||
		time_shell.has_heredoc(command) ||
		SUBSTITUTION.test(expanded) ||
		ENV_ASSIGNMENT.test(expanded) ||
		expanded.includes('$')
	)
}

function is_unsafe(command: string, root: string = process.cwd()): boolean {
	const plain = time_shell.blanked(command) ?? command
	if (input_is_unverified(command) || ARGUMENT_EXPANSION.test(plain)) return true

	return shell_segments
		.quote_aware_commands_of(command)
		.some((segment) => segment_is_unsafe(segment, root))
}

const implementation_shell = { is_unsafe }

export { implementation_shell }
