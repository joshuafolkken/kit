import { ALIASES } from '#scripts/josh/josh-command-map'
import { time_shell } from '#scripts/time/time-shell'

// **A shell line carries several commands, and each has to be judged on its own.** Every trigger in
// this directory that reads a command string needs the same cut, so the cut lives here rather than
// beside whichever trigger needed it first — the clone `CLAUDE.md` prohibits is two copies of a
// pattern that would then have to be corrected twice.
//
// **A bare `|` is deliberately not a separator.** It appears inside a `--jq` filter far more often
// than between two commands, and cutting there would split one call into fragments neither of which
// is command-shaped. The rule that *is* about a pipe reads the whole line instead
// (`piped-verification.ts`).
//
// **`early-heartbeat.ts` keeps its own separator on purpose** and is not a caller here: it adds `&`,
// because `sleep 1200 &` is an armed timer sent to the background and has to be seen as one. That is
// a different question about a different character, not a second copy of this answer.
const SEGMENT_SEPARATOR = /&&|\|\||;|\n/u

/** The line's commands, trimmed. Empty segments are kept: a caller anchoring at `^` rejects them. */
function segments_of(command: string): Array<string> {
	return command.split(SEGMENT_SEPARATOR).map((segment) => segment.trim())
}

// **Both spellings of a josh subcommand, derived from the alias table rather than restated beside the
// caller** (joshuafolkken/kit#1643). A second copy of the aliases stops matching the first time one is
// renamed, and `pnpm josh ga` masks a gate exactly as the long spelling does. Two rules in this
// directory now need that reading — the checks `piped-verification.ts` names and the watcher
// `early-heartbeat.ts` names — so it lives beside the cut rather than in whichever needed it first.
function josh_names(commands: Iterable<string>): ReadonlySet<string> {
	const named = new Set(commands)
	const aliases = Object.entries(ALIASES)
		.filter(([, name]) => named.has(name))
		.map(([alias]) => alias)

	return new Set([...named, ...aliases])
}

/** Whether this segment invokes one of the named josh subcommands, in either spelling. */
function is_josh_command(segment: string, names: ReadonlySet<string>): boolean {
	const named = time_shell.josh_command_of(segment)

	if (!named.startsWith(time_shell.JOSH_PREFIX)) return false

	return names.has(named.slice(time_shell.JOSH_PREFIX.length))
}

const shell_segments = {
	SEGMENT_SEPARATOR,
	is_josh_command,
	josh_names,
	segments_of,
}

export { shell_segments }
