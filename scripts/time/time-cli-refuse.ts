// The refusal predicates for `josh time`'s options, gathered so `time-cli` decides a whole
// invocation with one call rather than growing a condition per flag. Each mistake is refused rather
// than defaulted: a flag given but unparsed, a scope named twice, `--instructions` without a session,
// or `--run` beside a scope must never quietly report some other scope's time as though it were the
// one that was asked for.

// The value shape `parseArgs` hands back, read by the predicates below. Every field is optional
// because a flag that was not given is absent, and `--path` rides along unread here — it says where
// to read, not which run, so no refusal touches it (joshuafolkken/kit#1987).
interface RawValues {
	issue?: string
	session?: string
	epic?: string
	last?: string
	period?: string
	top?: string
	instructions?: boolean
	run?: boolean
	path?: string
}

// The four flags that carry a number, parsed. Grouped so the refusal asks one question of one record
// rather than growing a parameter per flag past the four-parameter limit.
interface ParsedNumbers {
	issue: number | undefined
	epic: number | undefined
	last: number | undefined
	period: number | undefined
	top: number | undefined
}

// Every flag whose value is a number, listed once so a fifth one is refused when it does not parse by
// being added here rather than remembered in a condition.
const NUMBER_KEYS = ['issue', 'epic', 'last', 'period', 'top'] as const

// The flags that name a scope. One list, so a fifth scope cannot be added to the parser and forgotten
// by the refusal, and `time-cli` derives the person-typed spellings from it.
const SCOPE_KEYS = ['issue', 'session', 'epic', 'last', 'period'] as const

// A flag that was given but did not parse is a refusal, not an absent flag: `--issue abc` must not
// quietly become "report the most recent run instead".
function is_unparsed(raw: string | undefined, parsed: number | undefined): boolean {
	return raw !== undefined && parsed === undefined
}

function has_unparsed(values: RawValues, parsed: ParsedNumbers): boolean {
	return NUMBER_KEYS.some((key) => is_unparsed(values[key], parsed[key]))
}

function named_scopes(values: RawValues): number {
	return SCOPE_KEYS.filter((key) => values[key] !== undefined).length
}

// `--instructions` reports on one transcript, so it is refused without a named session.
function refuses_instructions(values: RawValues): boolean {
	return values.instructions === true && values.session === undefined
}

// `--run` is the whole-tree scope, so it may not accompany a scope flag that names one run.
function refuses_run(values: RawValues): boolean {
	return values.run === true && named_scopes(values) > 0
}

// Naming more than one scope is refused too — they are different questions, and answering one of them
// silently is the wrong of the two.
function is_refused(values: RawValues, parsed: ParsedNumbers): boolean {
	if (has_unparsed(values, parsed)) return true
	if (refuses_instructions(values)) return true
	if (refuses_run(values)) return true

	return named_scopes(values) > 1
}

const time_cli_refuse = { SCOPE_KEYS, is_refused }

export type { RawValues, ParsedNumbers }
export { time_cli_refuse }
