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

// **Both spellings still match, and the expansion is no longer this file's** (joshuafolkken/kit#1643
// for the reading, joshuafolkken/kit#1789 for where it now happens). A `josh_names` here used to widen
// each caller's set with every alias standing for one of its names; `josh_command_of` expands the
// alias in the command it reads, so `pnpm josh ga` arrives as `josh gate` and a caller's canonical set
// matches it as it is. Widening as well would be a second copy of one rule, and the caller that
// forgot it would be the one that stops seeing `pnpm josh ga` at all — which is why each caller's own
// suite names a call in its alias spelling.
/** Whether this segment invokes one of the named josh subcommands, in either spelling. */
function is_josh_command(segment: string, names: ReadonlySet<string>): boolean {
	const named = time_shell.josh_command_of(segment)

	if (!named.startsWith(time_shell.JOSH_PREFIX)) return false

	return names.has(named.slice(time_shell.JOSH_PREFIX.length))
}

const shell_segments = {
	SEGMENT_SEPARATOR,
	is_josh_command,
	segments_of,
}

export { shell_segments }
