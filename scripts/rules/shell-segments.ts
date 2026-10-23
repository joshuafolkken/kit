import { time_shell } from '#scripts/time-runtime/time-shell'

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
const SEGMENT_PARTS = new RegExp(`(${SEGMENT_SEPARATOR.source})`, 'u')

// **The rows that read a segment as argv cut at the pipe and the background `&` as well.** Their
// question is which program a segment launches, and `true | git push -f` or `x & git push -f`
// launches git all the same; a `--jq` fragment cut off by a `|` begins with no program word, so it
// launches nothing they look for. A `&` that belongs to a redirection (`2>&1`, `&>file`, `<&3`) does
// not cut, nor does the `|` of the clobber redirect `>|`.
const COMMAND_SEPARATOR = /&&|\|\||;|\n|(?<!>)\|&?|(?<![<>])&(?!>)/u

/** The line's commands, trimmed. Empty segments are kept: a caller anchoring at `^` rejects them. */
function segments_of(command: string): Array<string> {
	return command.split(SEGMENT_SEPARATOR).map((segment) => segment.trim())
}

/** The line's commands as separate programs: the `segments_of` cut plus a pipe and a background `&`. */
function commands_of(command: string): Array<string> {
	return command.split(COMMAND_SEPARATOR).map((segment) => segment.trim())
}

const COMMAND_SEPARATORS = new RegExp(COMMAND_SEPARATOR.source, 'gu')

/**
 * The `commands_of` cut taken where the quote-blanked line puts each separator, so a `|` or `;`
 * inside a quoted argument does not cut it; a heredoc line falls back to `commands_of`.
 */
function quote_aware_commands_of(command: string): Array<string> {
	const plain = time_shell.blanked(command)

	if (plain === undefined) return commands_of(command)

	const cuts = [...plain.matchAll(COMMAND_SEPARATORS)].map((match) => ({
		begin: match.index,
		end: match.index + match[0].length,
	}))
	const starts = [0, ...cuts.map((cut) => cut.end)]
	const stops = cuts.map((cut) => cut.begin)

	return starts.map((start, index) => command.slice(start, stops[index] ?? command.length).trim())
}

const LINE_CONTINUATION = /\\\n/gu

/** The line with each backslash-newline joined, so a continued call stays one command at a `\n` cut. */
function joined_continuations(command: string): string {
	return command.replaceAll(LINE_CONTINUATION, ' ')
}

/** The same cut, untrimmed and with each separator kept between its commands, so the parts join back to the line. */
function parts_of(command: string): Array<string> {
	return command.split(SEGMENT_PARTS)
}

/**
 * The line's first command as the shell runs it — cut where the quote-blanked line puts the first
 * separator, so one inside a quoted string does not cut it — or `undefined` for a heredoc line.
 */
function first_of(command: string): string | undefined {
	const plain = time_shell.blanked(command)

	if (plain === undefined) return undefined

	const cut = plain.search(SEGMENT_SEPARATOR)

	return (cut === -1 ? command : command.slice(0, cut)).trim()
}

// **Both spellings match, and the expansion is not this file's.** `josh_command_of` expands the alias
// in the command it reads, so `pnpm josh ga` arrives as `josh gate` and a caller's canonical set
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
	commands_of,
	first_of,
	is_josh_command,
	joined_continuations,
	parts_of,
	quote_aware_commands_of,
	segments_of,
}

export { shell_segments }
