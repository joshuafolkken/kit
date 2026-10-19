// The two `sh` fragments both unit-suite shims are built from. Single-sourced because a guard's own
// defects fail **open**: a path that lost its quoting leaves the shim a syntax error that records
// nothing, and a `printf` that lost its `>>` truncates the record every call — in either case the
// run is reported clean while the calls keep going out. One spelling, used by every generator, is
// what keeps that impossible to get wrong in only one of them.

const SINGLE_QUOTE = "'"

// One `sh` word, quoted. A checkout under `/Users/o'brien` is not exotic, and an unquoted path there
// would close the quote and leave the rest of the line as syntax.
function quoted(value: string): string {
	// `sh` has no escape inside single quotes, so an apostrophe is written by closing the quote,
	// emitting an escaped one, and opening a new quote: `'\''`.
	return SINGLE_QUOTE + value.replaceAll("'", String.raw`'\''`) + SINGLE_QUOTE
}

// Append one line of prose to the shared record. `>>` rather than `>`, because every worker of the
// run writes to the same file and the last one must not erase what the others found.
function record_line(log_file: string, recorded: string): string {
	return String.raw`printf '%s\n' "${recorded}" >> ${quoted(log_file)}`
}

const shim_shell = { quoted, record_line }

export { shim_shell }
