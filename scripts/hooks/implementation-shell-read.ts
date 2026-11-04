import { git_argv } from '#scripts/rules/git-argv'

const SORT_WRITE = /^-(?:[A-Za-z]*o|-o)|^--(?:co|fil)/u
const SYSCTL_WRITE = /(?:^-(?:[A-Za-z]*[wfp]|-[wls]))|=/u
const AWK_EXECUTION = /[>|]|\b(?:system|getline)\b|@(?:include|load)|^-(?!F)/u
const SED_ADDRESS = String.raw`(?:\d+|\$|/[^/\n]*/)`
const SED_RANGE = String.raw`(?:${SED_ADDRESS}(?:,${SED_ADDRESS})?\s*!?\s*)?`
// Only scripts whose commands are visibly reads: selection, printing and substitution without
// execute/write flags. External script files and other commands cannot establish that fact.
const SED_READ = new RegExp(
	String.raw`^${SED_RANGE}(?:[pdq=]|s([^\w\s\\])(?:(?!\1)[^\n\\])*\1(?:(?!\1)[^\n\\])*\1[gIp\d]*)$`,
	'u',
)
const SED_FLAGS: ReadonlySet<string> = new Set(['-n', '-E', '-r', '--quiet', '--silent'])
const UNIQ_VALUE_FLAGS: ReadonlySet<string> = new Set(['-f', '-s', '-w'])
const TIME_WRITE = /^-(?:[A-Za-z]*o|-o)/u

function plain_argument(word: string): string | undefined {
	if (/^'[^']*'$/u.test(word) || /^"[^"\\$`]*"$/u.test(word)) return word.slice(1, -1)
	if (/['"\\$`]/u.test(word)) return undefined

	return word
}

function is_sed_read(args: ReadonlyArray<string>): boolean {
	const script_index = args.findIndex((argument) => !SED_FLAGS.has(argument))
	const script = args[script_index] ?? ''

	return (
		SED_READ.test(script) &&
		args.slice(script_index + 1).every((argument) => !argument.startsWith('-'))
	)
}

function uniq_input(args: ReadonlyArray<string>, index: number): boolean {
	if (UNIQ_VALUE_FLAGS.has(args[index - 1] ?? '')) return false

	const argument = args[index] ?? ''

	return argument === '-' || !argument.startsWith('-')
}

function uniq_operands(args: ReadonlyArray<string>): Array<string> {
	const end = args.indexOf('--')

	return args.filter((_, index) => (end !== -1 && index > end) || uniq_input(args, index))
}

function is_uniq_read(args: ReadonlyArray<string>): boolean {
	const operands = uniq_operands(args)

	return operands.length <= 1
}

const CHECKS: ReadonlyMap<string, (args: ReadonlyArray<string>) => boolean> = new Map([
	['sort', (args) => args.every((argument) => !SORT_WRITE.test(argument))],
	['sysctl', (args) => args.every((argument) => !SYSCTL_WRITE.test(argument))],
	['awk', (args) => args.every((argument) => !AWK_EXECUTION.test(argument))],
	['sed', is_sed_read],
	['uniq', is_uniq_read],
])

function is_read(segment: string, name: string): boolean {
	const call = git_argv.program_of(segment)
	const check = CHECKS.get(name)
	if (call === undefined || check === undefined) return false

	const args = call.args.map((argument) => plain_argument(argument))
	if (args.includes(undefined)) return false

	return check(args.filter((argument) => argument !== undefined))
}

// `program_of` skips time as a wrapper. Its own output destination still needs checking before
// the wrapped command is classified; timing a read must not admit a write through `time -o`.
function wrapper_writes(segment: string): boolean {
	const words = git_argv.words_of(segment)
	const index = words.findIndex((word) => /(?:^|\/)time$/u.test(word))
	if (index === -1) return false

	const call = git_argv.program_of(segment)
	const program_index = words.length - (call?.args.length ?? 0) - 1

	return words.slice(index + 1, program_index).some((word) => {
		const argument = plain_argument(word)

		return argument === undefined || TIME_WRITE.test(argument)
	})
}

const implementation_shell_read = { is_read, wrapper_writes }

export { implementation_shell_read }
