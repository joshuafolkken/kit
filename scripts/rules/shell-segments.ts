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

const shell_segments = {
	SEGMENT_SEPARATOR,
	segments_of,
}

export { shell_segments }
