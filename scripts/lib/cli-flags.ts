import { parseArgs, type ParseArgsConfig, type ParseArgsOptionsConfig } from 'node:util'

// Argument reading for the commands under `scripts/`.

const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h'])

// The usage line `refuse_unknown_flags` ends with, for a command that prints it on its own help
// request (`josh release --help`).
function usage_line(known_flags: ReadonlyArray<string>, command: string): string {
	if (known_flags.length === 0) return `Usage: josh ${command}`

	return `Usage: josh ${command} [${known_flags.join('] [')}]`
}

// Reject anything not on the list rather than ignoring it: a misspelled `--dryrun` that fell through
// would run the real write path. `josh propagate`, `josh adopt` and `josh release` all write, so
// the refusal is single-sourced here rather than described once per command (`CLAUDE.md` → "No
// clones").
function refuse_unknown_flags(
	argv: ReadonlyArray<string>,
	known_flags: ReadonlyArray<string>,
	command: string,
): string | undefined {
	const unknown = argv.filter((argument) => !known_flags.includes(argument))
	if (unknown.length === 0) return undefined

	return `Unknown argument(s): ${unknown.join(' ')}\n${usage_line(known_flags, command)}`
}

// The argument gate of a command that publishes (`josh release`, `josh release:github`): a help
// request prints the usage and exits 0, an unknown argument is refused with exit 1, both before any side effect. `undefined` means the
// arguments are all known and the command may run.
function answer_help_or_unknown(
	argv: ReadonlyArray<string>,
	known_flags: ReadonlyArray<string>,
	command: string,
): number | undefined {
	if (argv.some((argument) => HELP_FLAGS.has(argument))) {
		console.info(usage_line(known_flags, command))

		return 0
	}

	const refusal = refuse_unknown_flags(argv, known_flags, command)
	if (refusal === undefined) return undefined

	console.error(refusal)

	return 1
}

// `parseArgs`, answering `undefined` where it would throw — an unknown flag, a missing option value,
// or a positional the config does not allow. Each caller turns that into its usage line and a failure
// exit rather than a stack trace, on commands whose output a workflow reads; eleven of them had begun
// to carry a copy of the same try/catch each, and this is the one copy.
function parse_or_undefined<T extends ParseArgsConfig>(
	config: T,
): ReturnType<typeof parseArgs<T>> | undefined {
	try {
		return parseArgs(config)
	} catch {
		return undefined
	}
}

// The two shapes every command reads `argv` in: flags alone, or flags beside positionals. Both are
// strict, so an unknown flag is `undefined` rather than a silently ignored typo; the commands had each
// carried a one-line wrapper spelling these out.
type FlagsOnly<T extends ParseArgsOptionsConfig> = ReturnType<
	typeof parseArgs<{ args: Array<string>; options: T }>
>
type WithPositionals<T extends ParseArgsOptionsConfig> = ReturnType<
	typeof parseArgs<{ args: Array<string>; options: T; allowPositionals: true }>
>

function values_of<T extends ParseArgsOptionsConfig>(
	argv: ReadonlyArray<string>,
	options: T,
): FlagsOnly<T>['values'] | undefined {
	return parse_or_undefined({ args: [...argv], options })?.values
}

function arguments_of<T extends ParseArgsOptionsConfig>(
	argv: ReadonlyArray<string>,
	options: T,
): WithPositionals<T> | undefined {
	return parse_or_undefined({ args: [...argv], options, allowPositionals: true })
}

// A string option's value, or `undefined` where the flag was absent or parsed as anything else.
function string_of(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

const LONG_FLAG_PREFIX = '--'
const SHORT_FLAG_PREFIX = '-'

// The key `parseArgs` files a `--long-flag` under.
function option_name(flag: string): string {
	return flag.slice(LONG_FLAG_PREFIX.length)
}

// `parseArgs`'s own rule for a value it calls ambiguous: a dash and more. A lone `-` is a value — the
// stdin spelling `--body-file -` and `--decision-file -` rely on.
function is_unusable_value(value: string | boolean): boolean {
	if (typeof value === 'boolean' || value.length === 0) return true

	return value !== SHORT_FLAG_PREFIX && value.startsWith(SHORT_FLAG_PREFIX)
}

// Every value one value-taking flag was given, `true` standing for one given none. Read leniently, so an
// unknown flag elsewhere on the line does not hide the answer: a strict read only answers `undefined`
// for the whole line, and this is what lets a command name the one flag that went wrong.
function given_values(argv: ReadonlyArray<string>, flag: string): ReadonlyArray<string | boolean> {
	const name = option_name(flag)
	const given = parse_or_undefined({
		args: [...argv],
		options: { [name]: { type: 'string', multiple: true } },
		strict: false,
		allowPositionals: true,
	})?.values[name]

	return Array.isArray(given) ? given : []
}

// Whether a value-taking flag was given without a usable value — last on the line, followed by
// another flag, or empty — so a command can say which value a shell ate rather than print its
// generic usage.
function is_value_unusable(argv: ReadonlyArray<string>, flag: string): boolean {
	return given_values(argv, flag).some((value) => is_unusable_value(value))
}

function attach_one(attached: Array<string>, argument: string, flags: ReadonlyArray<string>): void {
	const previous = attached.at(-1)

	if (previous !== undefined && flags.includes(previous)) {
		attached[attached.length - 1] = `${previous}=${argument}`
	} else attached.push(argument)
}

// Joins each listed free-text flag to the token after it (`--body -x` → `--body=-x`), so a value that
// opens with a dash — a Markdown bullet — reaches the command instead of being refused by `parseArgs` as
// ambiguous. Only the listed flags are joined: anywhere else a dash-led token is still the next flag.
function attach_values(
	argv: ReadonlyArray<string>,
	flags: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const attached: Array<string> = []

	for (const argument of argv) attach_one(attached, argument, flags)

	return attached
}

// Digits and nothing else. `Number('')`, `Number(' ')` and `Number('0x10')` are all safe integers, so a
// check that only asked `Number.isSafeInteger` would read an unset shell variable — `--max
// "$max_issues"` — as zero. The magnitude check is separate because the pattern bounds nothing: a
// number past the safe range would be read as a different number.
const COUNT_PATTERN = /^\d+$/u
// Whole and positive: `0`, a sign, a decimal point and anything not a digit are refused.
const POSITIVE_PATTERN = /^[1-9]\d*$/u

// The value a positive-integer setting answers, or why it could not be read. A problem rather than a
// throw: the caller decides whether a bad setting ends the command or is reported and worked around.
type PositiveSetting = { kind: 'limit'; limit: number } | { kind: 'problem'; problem: string }

function to_integer(raw: string | undefined, pattern: RegExp): number | undefined {
	if (raw === undefined || !pattern.test(raw)) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
}

// A count flag's value — zero or more — or `undefined` when it is absent or not a count.
function to_count(raw: string | undefined): number | undefined {
	return to_integer(raw, COUNT_PATTERN)
}

// A value that must be one or more, or `undefined` when it is absent or not.
function to_positive(raw: string | undefined): number | undefined {
	return to_integer(raw, POSITIVE_PATTERN)
}

// A positive-integer setting read from the environment or an argument. Blank is unset, not invalid — an
// `.env` line left as `KEY=` is a setting nobody configured — and answers `fallback`. Anything else that
// is not a positive integer is a problem naming `name`, never a silent fall back to the default: a typo
// that quietly became the default is a number nobody chose.
function read_positive_setting(
	raw: string | undefined,
	name: string,
	fallback: number,
): PositiveSetting {
	const trimmed = raw?.trim() ?? ''

	if (trimmed === '') return { kind: 'limit', limit: fallback }

	const limit = to_positive(trimmed)
	if (limit !== undefined) return { kind: 'limit', limit }

	return { kind: 'problem', problem: `${name} must be a positive integer, not "${trimmed}"` }
}

const cli_flags = {
	to_count,
	to_positive,
	read_positive_setting,
	attach_values,
	usage_line,
	refuse_unknown_flags,
	answer_help_or_unknown,
	parse_or_undefined,
	values_of,
	arguments_of,
	string_of,
	option_name,
	given_values,
	is_value_unusable,
}

export { cli_flags }
export type { PositiveSetting }
