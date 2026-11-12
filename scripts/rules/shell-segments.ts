import { time_josh_names } from '#scripts/time-runtime/time-josh-names'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { shell_tokens, type ShellToken } from './shell-tokens'

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
const SEGMENT_OPERATORS: ReadonlySet<string> = new Set(['&&', '||', ';', ';;', ';;&', ';&', '\n'])

// **The rows that read a segment as argv cut at the pipe and the background `&` as well.** Their
// question is which program a segment launches, and `true | git push -f` or `x & git push -f`
// launches git all the same; a `--jq` fragment cut off by a `|` begins with no program word, so it
// launches nothing they look for. A `&` that belongs to a redirection (`2>&1`, `&>file`, `<&3`) is
// part of a word, not an operator, and so is the `|` of the clobber redirect `>|` (`shell-tokens.ts`).
const COMMAND_OPERATORS: ReadonlySet<string> = new Set([...SEGMENT_OPERATORS, '|', '|&', '&'])

// **A compound command's opening word is a cut too** (joshuafolkken/kit#7334): the command after it
// starts a segment of its own, so `f() { rm -rf x; }` yields `rm -rf x` for a rule anchored at `^rm`,
// and `case $x in a) rm -rf x;; esac` does the same past the arm's pattern. A `{` opens a group or a
// function body only at a command's start or after `name()`; a pattern closes with `)` right after
// `case … in` or after the previous arm's `;;`.
const CASE_ARM_ENDS: ReadonlySet<string> = new Set([';;', ';;&', ';&'])
const GROUP_OPENER = '{'
const FUNCTION_HEAD_END = '()'
const PATTERN_END = ')'
const NEWLINE = '\n'

type Cut = Pick<ShellToken, 'begin' | 'end'>

function is_group_opener(token: ShellToken, previous: ShellToken | undefined): boolean {
	if (token.text !== GROUP_OPENER) return false

	return (
		previous === undefined ||
		previous.kind === 'operator' ||
		previous.text.endsWith(FUNCTION_HEAD_END)
	)
}

function follows_case_head(tokens: ReadonlyArray<ShellToken>, index: number): boolean {
	return tokens.slice(0, index).some((token) => token.text === 'case')
}

// A pattern may start the line after `in` or `;;`, so the newlines between are passed over.
function lead_index(tokens: ReadonlyArray<ShellToken>, index: number): number {
	return tokens.slice(0, index).findLastIndex((token) => token.text !== NEWLINE)
}

function is_case_pattern(
	tokens: ReadonlyArray<ShellToken>,
	index: number,
	token: ShellToken,
): boolean {
	const lead_at = lead_index(tokens, index)
	const previous = tokens[lead_at]

	if (previous === undefined || !token.text.endsWith(PATTERN_END)) return false
	if (CASE_ARM_ENDS.has(previous.text)) return true

	return previous.text === 'in' && follows_case_head(tokens, lead_at)
}

function is_cut(
	tokens: ReadonlyArray<ShellToken>,
	index: number,
	operators: ReadonlySet<string>,
): boolean {
	const token = tokens[index]

	if (token === undefined) return false
	if (token.kind === 'operator') return operators.has(token.text)

	return is_group_opener(token, tokens[index - 1]) || is_case_pattern(tokens, index, token)
}

function cuts_of(reading: string, operators: ReadonlySet<string>): Array<Cut> {
	const tokens = shell_tokens.tokens_of(reading)

	return tokens.filter((_token, index) => is_cut(tokens, index, operators))
}

// The typed line between the cuts, untrimmed; the cuts were found on a reading with the same offsets.
function pieces_of(command: string, cuts: ReadonlyArray<Cut>): Array<string> {
	const starts = [0, ...cuts.map((cut) => cut.end)]

	return starts.map((start, index) => command.slice(start, cuts[index]?.begin ?? command.length))
}

function trimmed(pieces: ReadonlyArray<string>): Array<string> {
	return pieces.map((piece) => piece.trim())
}

/** The line's commands, trimmed. Empty segments are kept: a caller anchoring at `^` rejects them. */
function segments_of(command: string): Array<string> {
	return trimmed(pieces_of(command, cuts_of(command, SEGMENT_OPERATORS)))
}

/** The line's commands as separate programs: the `segments_of` cut plus a pipe and a background `&`. */
function commands_of(command: string): Array<string> {
	return trimmed(pieces_of(command, cuts_of(command, COMMAND_OPERATORS)))
}

/**
 * The `commands_of` cut taken where the quote-blanked line puts each separator, so a `|` or `;`
 * inside a quoted argument does not cut it; a heredoc line falls back to `commands_of`.
 */
function quote_aware_commands_of(command: string): Array<string> {
	const plain = time_shell.blanked(command)

	if (plain === undefined) return commands_of(command)

	return trimmed(pieces_of(command, cuts_of(plain, COMMAND_OPERATORS)))
}

const LINE_CONTINUATION = /\\\n/gu

/** The line with each backslash-newline joined, so a continued call stays one command at a `\n` cut. */
function joined_continuations(command: string): string {
	return command.replaceAll(LINE_CONTINUATION, ' ')
}

/** The same cut, untrimmed and with each separator kept between its commands, so the parts join back to the line. */
function parts_of(command: string): Array<string> {
	const cuts = cuts_of(command, SEGMENT_OPERATORS)

	return pieces_of(command, cuts).flatMap((piece, index) => {
		const cut = cuts[index]

		return cut === undefined ? piece : [piece, command.slice(cut.begin, cut.end)]
	})
}

/**
 * The line's first command as the shell runs it — cut where the quote-blanked line puts the first
 * separator, so one inside a quoted string does not cut it — or `undefined` for a heredoc line.
 */
function first_of(command: string): string | undefined {
	const plain = time_shell.blanked(command)

	if (plain === undefined) return undefined

	const [cut] = cuts_of(plain, SEGMENT_OPERATORS)

	return command.slice(0, cut?.begin ?? command.length).trim()
}

// **Both spellings match, and the expansion is not this file's.** `time_josh_names` expands the alias
// in the command it reads, so `pnpm josh ga` arrives as `josh gate` and a caller's canonical set
// matches it as it is. Widening as well would be a second copy of one rule, and the caller that
// forgot it would be the one that stops seeing `pnpm josh ga` at all — which is why each caller's own
// suite names a call in its alias spelling.
/** Whether this segment invokes one of the named josh subcommands, in either spelling. */
function is_josh_command(segment: string, names: ReadonlySet<string>): boolean {
	const named = time_josh_names.josh_command_of(segment)

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
