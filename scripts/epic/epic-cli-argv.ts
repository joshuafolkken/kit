import type { ParseArgsOptionsConfig } from 'node:util'
import { cli_flags } from '#scripts/lib/cli-flags'

// The argument reading every `josh epic` form shares, on top of `cli_flags`.
//
// They were private to `epic-cli.ts` until `--remove` needed the same readers,
// at which point the choice was to copy them or to name them. Copying is what `CLAUDE.md` prohibits,
// and the failure it would produce is specific: two readers disagreeing about what counts as a flag
// value would have one form silently take a `--decision-file` path for an issue number.
//
// **Each form names its own flags, and the read is strict.** Which flags consume the argument after
// them is per form: `--before` takes a value only under `--add`, and treating it as one everywhere had
// `josh epic "T" 101 102 --after 103` silently drop #103. A flag the form does
// not know refuses the invocation — a mistyped flag would otherwise leave its value positional, so it
// becomes an issue number and the edit silently lands somewhere else.

// Every value flag is read as a list so a repeat is visible rather than resolved to one of the two:
// two `--decision-file` paths name two records, and two `--before` targets name two places.
const VALUE_OPTION = { type: 'string', multiple: true } as const
const SWITCH_OPTION = { type: 'boolean' } as const
const SINGLE = 1

type ParsedValue = string | boolean | Array<string | boolean> | undefined

interface EpicArgv {
	positionals: Array<string>
	values: Readonly<Record<string, ParsedValue>>
}

interface FormFlags {
	switches: ReadonlyArray<string>
	value_flags?: ReadonlyArray<string>
}

type OptionEntry = [string, ParseArgsOptionsConfig[string]]

function options_of(form: FormFlags): ParseArgsOptionsConfig {
	const entries: Array<OptionEntry> = [
		...form.switches.map((flag): OptionEntry => [cli_flags.option_name(flag), SWITCH_OPTION]),
		...(form.value_flags ?? []).map((flag): OptionEntry => [
			cli_flags.option_name(flag),
			VALUE_OPTION,
		]),
	]

	return Object.fromEntries(entries)
}

// Every value a flag was given, in order; empty when it was absent.
function values_of_flag(parsed: EpicArgv, flag: string): ReadonlyArray<string> {
	const given = parsed.values[cli_flags.option_name(flag)]
	if (!Array.isArray(given)) return []

	return given.filter((value): value is string => typeof value === 'string')
}

function count_flag(parsed: EpicArgv, flag: string): number {
	return values_of_flag(parsed, flag).length
}

function is_repeated(parsed: EpicArgv, flag: string): boolean {
	return count_flag(parsed, flag) > SINGLE
}

// The form's arguments, or `undefined` when a flag is unknown, a value is missing, or a value flag was
// given twice — a repeat is refused rather than silently taking one of the two.
function read_form(argv: ReadonlyArray<string>, form: FormFlags): EpicArgv | undefined {
	const parsed = cli_flags.arguments_of(argv, options_of(form))
	if (parsed === undefined) return undefined

	return (form.value_flags ?? []).some((flag) => is_repeated(parsed, flag)) ? undefined : parsed
}

// The form's positional arguments, or none when the read refused the invocation.
function positionals_of(argv: ReadonlyArray<string>, form: FormFlags): Array<string> {
	return read_form(argv, form)?.positionals ?? []
}

function read_flag_value(parsed: EpicArgv, flag: string): string | undefined {
	return values_of_flag(parsed, flag)[0]
}

function is_switch_set(parsed: EpicArgv, flag: string): boolean {
	return parsed.values[cli_flags.option_name(flag)] === true
}

// A value-taking flag given without a usable value, or given twice. **Refused rather than read as "none
// was asked for"** — `--decision-file` is passed precisely because the record has to exist, so a shell
// that ate the path would otherwise land the edit, write no record, post no comment and exit 0: success
// reported for half the job. Repeated, it names two records.
function is_value_unusable(argv: ReadonlyArray<string>, flag: string): boolean {
	return (
		cli_flags.given_values(argv, flag).length > SINGLE || cli_flags.is_value_unusable(argv, flag)
	)
}

const epic_cli_argv = {
	read_form,
	positionals_of,
	read_flag_value,
	is_switch_set,
	count_flag,
	is_value_unusable,
}

export { epic_cli_argv }
export type { EpicArgv, FormFlags }
