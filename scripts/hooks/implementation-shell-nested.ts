import { git_argv, type ProgramCall } from '#scripts/rules/git-argv'
import { time_shell } from '#scripts/time-runtime/time-shell'

// The commands a line runs inside another one (joshuafolkken/kit#6586): a command or process
// substitution, and the programs a launcher (`xargs`, `timeout`, `nice`, …), `find -exec`, `sh -c`,
// `eval` and a josh entry script run by `node` launch. Each is judged as a command of its own, so a
// deny-listed call is refused wherever it is nested.

const SUBSTITUTION = /\$\(([^()]*)\)|`([^`]*)`|[<>]\(([^()]*)\)/u
const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash'])
const SHELL_COMMAND_LETTER = 'c'
const SHELL_STDIN_LETTER = 's'
const FIND_RUNNERS = /^-(?:exec|execdir|ok|okdir)$/u
const FIND_ENDS: ReadonlySet<string> = new Set([';', String.raw`\;`, "';'", '+'])
const JOSH_SCRIPT = /(?:^|\/)josh[\w-]*\.ts$/u
// The words `xargs` adds from its input, which may spell any subcommand: read as an expansion.
const INPUT_WORDS = '$xargs'
const AFTER_VALUE = 2
const QUOTED = /^(?<quote>['"])(?<body>[\s\S]*)\k<quote>$/u

// A program that runs the command its arguments spell: its flags whose value is the next word, the
// operands before the command (`timeout <duration>`), and whether it adds words from its input.
interface Launcher {
	value_flags: ReadonlySet<string>
	operands: number
	is_appending: boolean
}

const LAUNCHERS: ReadonlyMap<string, Launcher> = new Map([
	[
		'xargs',
		{
			value_flags: new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a']),
			operands: 0,
			is_appending: true,
		},
	],
	[
		'timeout',
		{
			value_flags: new Set(['-s', '--signal', '-k', '--kill-after']),
			operands: 1,
			is_appending: false,
		},
	],
	['nice', { value_flags: new Set(['-n', '--adjustment']), operands: 0, is_appending: false }],
	['nohup', { value_flags: new Set(), operands: 0, is_appending: false }],
	['stdbuf', { value_flags: new Set(['-i', '-o', '-e']), operands: 0, is_appending: false }],
	['watch', { value_flags: new Set(['-n', '--interval']), operands: 0, is_appending: false }],
])

function unquoted(word: string): string {
	return QUOTED.exec(word)?.groups?.['body'] ?? word
}

// Innermost first, each replaced by a blank, so an enclosing substitution is read once its inner one
// is gone. A single-quoted span expands nothing, so it is blanked before the search.
function substitution_bodies(command: string): Array<string> {
	const bodies: Array<string> = []
	let rest = time_shell.literal_blanked(command)
	let match = SUBSTITUTION.exec(rest)

	while (match !== null) {
		// One alternative matched; `join` reads the others' unmatched groups as empty.
		bodies.push(match.slice(1).join(''))
		rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`
		match = SUBSTITUTION.exec(rest)
	}

	return bodies
}

function after_flag(launcher: Launcher, args: ReadonlyArray<string>, index: number): number {
	return index + (launcher.value_flags.has(args[index] ?? '') ? AFTER_VALUE : 1)
}

function launched_commands(launcher: Launcher, args: ReadonlyArray<string>): Array<string> {
	let index = 0

	while (args[index]?.startsWith('-') === true) index = after_flag(launcher, args, index)

	const words = args.slice(index + launcher.operands)
	if (words.length === 0) return []

	return [[...words, ...(launcher.is_appending ? [INPUT_WORDS] : [])].join(' ')]
}

// `node tools/josh/josh-ready.ts git -y` is `josh git -y`.
function josh_script_commands(args: ReadonlyArray<string>): Array<string> {
	const index = args.findIndex((argument) => JOSH_SCRIPT.test(argument))

	return index === -1 ? [] : [['josh', ...args.slice(index + 1)].join(' ')]
}

function find_body(args: ReadonlyArray<string>, start: number): string {
	const end = args.findIndex((argument, index) => index >= start && FIND_ENDS.has(argument))

	return args.slice(start, end === -1 ? undefined : end).join(' ')
}

function find_commands(args: ReadonlyArray<string>): Array<string> {
	return args.flatMap((argument, index) =>
		FIND_RUNNERS.test(argument) ? find_body(args, index + 1) : [],
	)
}

function shell_commands(args: ReadonlyArray<string>): Array<string> {
	const index = args.findIndex((argument) =>
		git_argv.short_cluster_has(argument, SHELL_COMMAND_LETTER),
	)
	const body = index === -1 ? undefined : args[index + 1]

	return body === undefined ? [] : [unquoted(body)]
}

function eval_commands(args: ReadonlyArray<string>): Array<string> {
	return [args.map((argument) => unquoted(argument)).join(' ')]
}

const RUNNERS: ReadonlyMap<string, (args: ReadonlyArray<string>) => Array<string>> = new Map([
	['find', find_commands],
	['eval', eval_commands],
	['node', josh_script_commands],
	...[...SHELLS].map((shell): [string, typeof shell_commands] => [shell, shell_commands]),
])

function call_commands(call: ProgramCall): Array<string> {
	const launcher = LAUNCHERS.get(call.name)
	if (launcher !== undefined) return launched_commands(launcher, call.args)

	return RUNNERS.get(call.name)?.(call.args) ?? []
}

// A shell given no `-c` and no script, or `-s`, runs what its standard input spells, which no check
// before the call can read (`echo git push | sh`).
function reads_stdin(call: ProgramCall): boolean {
	if (!SHELLS.has(call.name)) return false

	if (call.args.some((argument) => git_argv.short_cluster_has(argument, SHELL_STDIN_LETTER))) {
		return true
	}

	return call.args.every((argument) => argument.startsWith('-'))
}

const implementation_shell_nested = { call_commands, reads_stdin, substitution_bodies }

export { implementation_shell_nested }
