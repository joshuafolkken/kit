import { parseArgs, type ParseArgsConfig } from 'node:util'

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

const cli_flags = { refuse_unknown_flags, parse_or_undefined }

export { cli_flags }
