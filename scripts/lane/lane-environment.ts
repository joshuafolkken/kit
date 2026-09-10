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

// Where the delegated unit running this lane's child writes (joshuafolkken/kit#1713). It goes in the
// lane's own `.env` — the store `lane-registry.ts` already reads — rather than in a ledger beside the
// trees, so `git worktree remove` erases the record along with the lane it described and there is
// nothing left to go stale. `.env` is gitignored in kit and in every consumer `josh sync` reaches,
// which is the objection that sent the run hold's stamp to the temp directory instead.
const LANE_OUTPUT_KEY = 'JOSH_LANE_OUTPUT'
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

function is_key_line(line: string, key: string): boolean {
	const body = strip_export(line)

	if (!body.startsWith(key)) return false

	return body.slice(key.length).trimStart().startsWith(ASSIGNMENT_SEPARATOR)
}

function is_seed_line(line: string): boolean {
	return is_key_line(line, PORT_SEED_KEY)
}

function is_output_line(line: string): boolean {
	return is_key_line(line, LANE_OUTPUT_KEY)
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

function assignment_value(line: string): string {
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
	const raw = line === undefined ? undefined : assignment_value(line)

	return ports.resolve_seed({ [PORT_SEED_KEY]: raw })
}

/**
 * The output path a lane's `.env` records, or `undefined` where it records none.
 *
 * **A blank assignment is `undefined` rather than an empty path** (joshuafolkken/kit#1713). A lane
 * whose record was cleared has nothing to poll, and an empty string handed to
 * `pnpm josh run:liveness --output` is a relative path — refused by its own root check, so the
 * child would come back `undetermined` for ever rather than saying the record is missing.
 */
function read_lane_output(content: string): string | undefined {
	const line = split_lines(content).findLast((entry) => is_output_line(entry))
	const raw = line === undefined ? undefined : assignment_value(line)

	return raw === undefined || raw.length === 0 ? undefined : raw
}

/**
 * The root file with its seed replaced, or with one appended where it had none.
 *
 * Replacing in place rather than appending is what keeps the file honest for a person reading it:
 * two `PORT_SEED` lines would work — the last wins — and would say two different things.
 */
// Every other line for the same key is dropped rather than rewritten alongside: a file carrying two
// of them works — the last wins — and says two different things to the person reading it.
function replace_assignment(
	lines: ReadonlyArray<string>,
	keep: number,
	assignment: string,
	key: string,
): Array<string> {
	return lines.flatMap((entry, index) => {
		if (index === keep) return [assignment]

		return is_key_line(entry, key) ? [] : [entry]
	})
}

function upsert_assignment(content: string, key: string, value: string): string {
	const assignment = `${key}${ASSIGNMENT_SEPARATOR}${value}`
	const lines = split_lines(content)
	const last = lines.findLastIndex((entry) => is_key_line(entry, key))
	const body =
		last === -1 ? [...lines, assignment] : replace_assignment(lines, last, assignment, key)

	return `${body.join('\n')}\n`
}

function lane_file_content(root_content: string, seed: number): string {
	return upsert_assignment(root_content, PORT_SEED_KEY, String(seed))
}

/**
 * The lane's `.env` with its recorded output path replaced, or with one appended where it had none.
 *
 * **The value is quoted, and the seed's is not.** A seed is digits; a path can hold a space or a
 * `#`, and dotenv readers cut a value at an unquoted ` #` — so an unquoted record would come back
 * truncated to something that still looks like a path. `read_lane_output` unquotes symmetrically.
 */
function with_lane_output(content: string, output: string): string {
	return upsert_assignment(content, LANE_OUTPUT_KEY, `"${output}"`)
}

const lane_environment = {
	LANE_OUTPUT_KEY,
	is_output_line,
	is_seed_line,
	lane_file_content,
	read_lane_output,
	read_root_seed,
	with_lane_output,
}

export { lane_environment }
