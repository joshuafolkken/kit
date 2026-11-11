import { git_argv, type ProgramCall } from './git-argv'

// The program a `Bash` segment finally runs, for `egress-guard.ts`: `program_of` stops at a launcher
// it does not skip (`timeout 5 curl …`) and takes a wrapper's first flag for the program
// (`env -u X curl …`), so the call is read again from the program those hand over to.

const FLAG_PREFIX = '-'
const NEXT = 1
// From the program word back to the word before it.
const BEFORE_PROGRAM = 2
// `env`'s flags that take a separate value (`env -u NAME`).
const ENV_VALUE_FLAGS: ReadonlySet<string> = new Set(['-u', '--unset', '-C', '--chdir'])
// A quoted or escaped program name (`"curl"`, `c\url`) still runs the program.
const NAME_NOISE = /["'\\]/gu
// `command -v curl` only looks `curl` up; `program_of` skips `command` and reads the flag.
const LOOKUP_WRAPPER = 'command'
const LOOKUP_FLAGS: ReadonlySet<string> = new Set(['-v', '-V'])

interface Launcher {
	value_flags: ReadonlySet<string>
	// The operands before the program (`timeout 30 curl`).
	operands: number
}

function launcher(value_flags: ReadonlyArray<string>, operands = 0): Launcher {
	return { value_flags: new Set(value_flags), operands }
}

// Launchers `program_of` does not skip, which run the program their first free operand names — past
// their own flags and those flags' separate values.
const LAUNCHERS: ReadonlyMap<string, Launcher> = new Map([
	['busybox', launcher([])],
	['nice', launcher(['-n', '--adjustment'])],
	['nohup', launcher([])],
	['stdbuf', launcher(['-i', '-o', '-e', '--input', '--output', '--error'])],
	['timeout', launcher(['-s', '--signal', '-k', '--kill-after'], 1)],
	['xcrun', launcher(['--sdk', '-sdk', '--toolchain', '-toolchain'])],
	[
		'xargs',
		launcher(['-a', '--arg-file', '-d', '--delimiter', '-E', '-I', '-L', '-n', '-P', '-s']),
	],
])

function plain_name(word: string): string {
	return word.replaceAll(NAME_NOISE, '').split('/').at(-1) ?? ''
}

function is_environment_operand(words: ReadonlyArray<string>, index: number): boolean {
	const word = words[index] ?? ''

	return (
		!word.startsWith(FLAG_PREFIX) &&
		!word.includes('=') &&
		!ENV_VALUE_FLAGS.has(words[index - NEXT] ?? '')
	)
}

// The first word is a flag, so the rest is shorter; no operand left is a bare `env`.
function past_environment_flags(words: ReadonlyArray<string>): ReadonlyArray<string> {
	const index = words.findIndex((_word, position) => is_environment_operand(words, position))

	return index === -1 ? [] : words.slice(index)
}

function is_launcher_operand(
	args: ReadonlyArray<string>,
	index: number,
	value_flags: ReadonlySet<string>,
): boolean {
	return !(args[index] ?? '').startsWith(FLAG_PREFIX) && !value_flags.has(args[index - NEXT] ?? '')
}

// The index of the program word, or -1 when the launcher names none.
function launched_index(args: ReadonlyArray<string>, spec: Launcher): number {
	const operands = args
		.map((_word, index) => index)
		.filter((index) => is_launcher_operand(args, index, spec.value_flags))

	return operands[spec.operands] ?? -1
}

function past_launcher(call: ProgramCall): ReadonlyArray<string> | undefined {
	const spec = LAUNCHERS.get(call.name)

	if (spec === undefined) return undefined

	const index = launched_index(call.args, spec)

	return index === -1 ? undefined : call.args.slice(index)
}

// The words from the program a call hands over to: past a wrapper's flags, or past a launcher.
// `undefined` when the call runs its own program.
function inner_words_of(call: ProgramCall | undefined): ReadonlyArray<string> | undefined {
	if (call === undefined) return undefined
	if (call.name.startsWith(FLAG_PREFIX)) return past_environment_flags([call.name, ...call.args])

	return past_launcher(call)
}

// The word in front of the program word; `args` are the words after it.
function word_before(segment: string, call: ProgramCall): string {
	const words = git_argv.words_of(segment)

	return words[words.length - call.args.length - BEFORE_PROGRAM] ?? ''
}

// The program `segment` launches, read as `command` itself when it only looks the program up.
function call_of(segment: string): ProgramCall | undefined {
	const call = git_argv.program_of(segment)

	if (call === undefined) return undefined

	const is_lookup =
		LOOKUP_FLAGS.has(call.name) && plain_name(word_before(segment, call)) === LOOKUP_WRAPPER

	return { name: is_lookup ? LOOKUP_WRAPPER : plain_name(call.name), args: call.args }
}

// Each round reads a shorter word list, so the loop ends.
function resolved_call(segment: string): ProgramCall | undefined {
	let call = call_of(segment)
	let inner = inner_words_of(call)

	while (inner !== undefined) {
		call = call_of(inner.join(' '))
		inner = inner_words_of(call)
	}

	return call
}

const launched_call = { plain_name, resolved_call }

export { launched_call }
