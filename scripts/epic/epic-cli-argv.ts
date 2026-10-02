// The argument-reading primitives every `josh epic` form shares.
//
// They were private to `epic-cli.ts` until `--remove` needed the same four (joshuafolkken/kit#1712),
// at which point the choice was to copy them or to name them. Copying is what `CLAUDE.md` prohibits,
// and the failure it would produce is specific: two readers disagreeing about what counts as a flag
// value would have one form silently take a `--decision-file` path for an issue number.

const FLAG_PREFIX = '--'
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u

function is_flag(argument: string): boolean {
	return argument.startsWith(FLAG_PREFIX)
}

function read_flag_value(argv: ReadonlyArray<string>, flag: string): string | undefined {
	const index = argv.indexOf(flag)
	if (index === -1) return undefined

	return argv[index + 1]
}

// A value-taking flag's argument must not be mistaken for a child issue number, so the argument
// directly after one is dropped along with the flag itself.
function is_flag_value(
	argv: ReadonlyArray<string>,
	index: number,
	value_flags: ReadonlySet<string>,
): boolean {
	return value_flags.has(argv[index - 1] ?? '')
}

// **Which flags consume the argument after them is per parser, not module-wide**: `--before` takes a
// value only under `--add`, and treating it as one everywhere had `josh epic "T" 101 102 --after 103`
// silently drop #103 from the new epic instead of ignoring an unknown flag (joshuafolkken/kit#890).
function to_positional_arguments(
	argv: ReadonlyArray<string>,
	value_flags: ReadonlySet<string>,
): Array<string> {
	return argv.filter(
		(argument, index) => !is_flag(argument) && !is_flag_value(argv, index, value_flags),
	)
}

function count_flag(argv: ReadonlyArray<string>, flag: string): number {
	return argv.filter((argument) => argument === flag).length
}

// A value-taking flag given without a usable value: last on the line, or followed by another flag.
// **Refused rather than read as "none was asked for"** — `--decision-file` is passed precisely because
// the record has to exist, so a shell that ate the path would otherwise land the edit, write no
// record, post no comment and exit 0: success reported for half the job. Repeated, it names two
// records, which is refused for the reason two positioning flags are (joshuafolkken/kit#1350).
function is_value_unusable(argv: ReadonlyArray<string>, flag: string): boolean {
	if (!argv.includes(flag)) return false
	if (count_flag(argv, flag) > 1) return true
	const value = read_flag_value(argv, flag)

	return value === undefined || is_flag(value)
}

// `--add` and `--remove` refuse a flag they do not know, unlike creation and promotion which ignore
// one. A typo there costs a flag; here a mistyped flag would leave its value positional, so it
// becomes an issue number and the edit silently lands somewhere else (joshuafolkken/kit#890).
function has_unknown_flag(argv: ReadonlyArray<string>, known: ReadonlySet<string>): boolean {
	return argv.some((argument) => is_flag(argument) && !known.has(argument))
}

const epic_cli_argv = {
	is_flag,
	read_flag_value,
	to_positional_arguments,
	count_flag,
	is_value_unusable,
	has_unknown_flag,
}

export { epic_cli_argv, ISSUE_NUMBER_PATTERN }
