import { parseArgs, type ParseArgsConfig, type ParseArgsOptionsConfig } from 'node:util'

// Argument reading for the commands under `scripts/`.
//
// Reject anything not on the list rather than ignoring it: a misspelled `--dryrun` that fell through
// would run the real write path. `josh propagate` and `josh adopt` both write into working trees, so
// the refusal is single-sourced here rather than described once per command (`CLAUDE.md` → "No
// clones").
function refuse_unknown_flags(
	argv: ReadonlyArray<string>,
	known_flags: ReadonlyArray<string>,
	command: string,
): string | undefined {
	const unknown = argv.filter((argument) => !known_flags.includes(argument))
	if (unknown.length === 0) return undefined
	const usage = `Usage: josh ${command} [${known_flags.join('] [')}]`

	return `Unknown argument(s): ${unknown.join(' ')}\n${usage}`
}

// `parseArgs`, answering `undefined` where it would throw — an unknown flag, a missing option value,
// or a positional the config does not allow. Each caller turns that into its usage line and a failure
// exit rather than a stack trace, on commands whose output a workflow reads; eleven of them had begun
// to carry a copy of the same try/catch each (joshuafolkken/kit#2902), and this is the one copy.
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
// carried a one-line wrapper spelling these out (joshuafolkken/kit#3072).
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

const cli_flags = {
	refuse_unknown_flags,
	parse_or_undefined,
	values_of,
	arguments_of,
	string_of,
	option_name,
	given_values,
	is_value_unusable,
}

export { cli_flags }
