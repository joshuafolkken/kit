// Argument refusal for the small flag-only commands.
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

export { refuse_unknown_flags }
