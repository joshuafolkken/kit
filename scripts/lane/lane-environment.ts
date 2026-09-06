import { PORT_SEED_KEY, ports } from '#ports'

// The lane's `.env`, built from the root's (joshuafolkken/kit#1490).
//
// **Port separation is required here, not optional.** `PORT_SEED` is read from the project root's
// uncommitted `.env`, and `ports/index.js` resolves that root as the nearest ancestor holding a
// `package.json` — which, inside a linked work tree, is the lane's own directory. So a lane with no
// `.env` runs on seed 0 and a lane handed a verbatim copy runs on the root's seed; either way every
// lane lands on one pair of ports, and a busy port fails without retrying on another. At the
// default six lanes that turns E2E from "fails sometimes" into "fails nearly always".
//
// **Everything else in the file is carried across verbatim**, comments and blank lines included:
// `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `JOSH_SESSION_LANG` and whatever else the person has set
// are as necessary inside a lane as outside one, and a lane that had to have them re-entered would
// not be a place a run could start unattended.

const ASSIGNMENT_SEPARATOR = '='
// `export PORT_SEED=3` is a form dotenv readers accept, so an assignment written that way has to be
// read as the seed line rather than copied through beside the one appended below.
const EXPORT_PREFIX = 'export '
// `PORT_SEED="3"` and `PORT_SEED='3'` are both accepted by `process.loadEnvFile`, and the quotes are
// not part of the value — passing them to the seed validator would fail a file that works.
const QUOTE_CHARACTERS = new Set(['"', "'"])
const MIN_QUOTED_LENGTH = 2
const FIRST_CHARACTER_END = 1
const LAST_CHARACTER_START = -1

// Read character by character rather than by regular expression: the pattern this replaced —
// optional leading blanks, an optional `export`, more blanks — backtracks super-linearly on a long
// line of spaces, which `.env` files pick up from careless editors.
function strip_export(line: string): string {
	const trimmed = line.trimStart()

	return trimmed.startsWith(EXPORT_PREFIX)
		? trimmed.slice(EXPORT_PREFIX.length).trimStart()
		: trimmed
}

function is_seed_line(line: string): boolean {
	const body = strip_export(line)

	if (!body.startsWith(PORT_SEED_KEY)) return false

	return body.slice(PORT_SEED_KEY.length).trimStart().startsWith(ASSIGNMENT_SEPARATOR)
}

// `trimEnd` rather than a trailing-newline pattern: the file is rejoined with one newline at the end
// whatever it arrived with, so what is dropped here is only ever whitespace nothing reads.
function split_lines(content: string): Array<string> {
	const trimmed = content.trimEnd()

	return trimmed.length === 0 ? [] : trimmed.split('\n')
}

function is_quoted(raw: string): boolean {
	const first = raw.slice(0, FIRST_CHARACTER_END)

	if (!QUOTE_CHARACTERS.has(first)) return false

	return raw.length >= MIN_QUOTED_LENGTH && raw.endsWith(first)
}

function unquote(raw: string): string {
	return is_quoted(raw) ? raw.slice(FIRST_CHARACTER_END, LAST_CHARACTER_START) : raw
}

function seed_value(line: string): string {
	return unquote(line.slice(line.indexOf(ASSIGNMENT_SEPARATOR) + FIRST_CHARACTER_END).trim())
}

/**
 * The seed the root `.env` sets, which every lane's own seed is offset from.
 *
 * The validation is `ports.resolve_seed`'s rather than a second copy of it, so a malformed
 * `PORT_SEED` fails when a lane is opened for the same reason and with the same message it fails
 * when `josh port` reads it — a lane that silently fell back to 0 would put itself on the root's
 * ports, which is the one outcome this module exists to prevent.
 */
function read_root_seed(root_content: string): number {
	// **The last assignment wins, which is what `.env` itself means.** A root file that kept the blank
	// `PORT_SEED=` from `.env.example` and appended a real one later would otherwise read as seed 0
	// here and as the real seed everywhere else — and the lane band would then run straight over the
	// main work tree's own ports.
	const line = split_lines(root_content).findLast((entry) => is_seed_line(entry))
	const raw = line === undefined ? undefined : seed_value(line)

	return ports.resolve_seed({ [PORT_SEED_KEY]: raw })
}

/**
 * The root file with its seed replaced, or with one appended where it had none.
 *
 * Replacing in place rather than appending is what keeps the file honest for a person reading it:
 * two `PORT_SEED` lines would work — the last wins — and would say two different things.
 */
// Every other seed line is dropped rather than rewritten alongside: a file carrying two of them
// works — the last wins — and says two different things to the person reading it.
function replace_seed_line(
	lines: ReadonlyArray<string>,
	keep: number,
	assignment: string,
): Array<string> {
	return lines.flatMap((entry, index) => {
		if (index === keep) return [assignment]

		return is_seed_line(entry) ? [] : [entry]
	})
}

function lane_file_content(root_content: string, seed: number): string {
	const assignment = `${PORT_SEED_KEY}${ASSIGNMENT_SEPARATOR}${String(seed)}`
	const lines = split_lines(root_content)
	const last_seed = lines.findLastIndex((entry) => is_seed_line(entry))
	const body =
		last_seed === -1 ? [...lines, assignment] : replace_seed_line(lines, last_seed, assignment)

	return `${body.join('\n')}\n`
}

const lane_environment = {
	is_seed_line,
	lane_file_content,
	read_root_seed,
}

export { lane_environment }
