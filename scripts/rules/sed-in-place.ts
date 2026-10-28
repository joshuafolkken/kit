import { file_reader } from '#scripts/lib/read-file'
import { bash_triggers } from './bash-triggers'
import { git_argv } from './git-argv'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `sed-in-place` row of `delivered-rules.ts`: a `sed -i`
// that `file-edits.md`'s countable conditions do not clear (joshuafolkken/kit#5284).
//
// **The conditions are counts, so the guard counts them.** `file-edits.md` allows `sed -i` only for a
// single `s` command whose pattern carries no meta character and matches exactly once in each target
// file. Anything else — a meta character, a count other than one, a script that is not one `s` command —
// can rewrite a line the run never meant to touch, and `Edit` is the tool that cannot.
//
// It fires on every occurrence, for the reason `file-body.ts` does.

const SED = 'sed'
// `-i`, `-i.bak`, `-Ei`: a short cluster carrying the in-place switch; `--in-place[=suffix]` long.
const IN_PLACE_SHORT = /^-[A-Za-z]*i/u
const IN_PLACE_LONG = /^--in-place(?:=|$)/u
const BARE_IN_PLACE = '-i'
const SCRIPT_FLAG = '-e'
const FLAG_PREFIX = '-'
const SURROUNDING_QUOTES = /^(['"])(.*)\1$/su
const QUOTED_BODY = 2
// `file-edits.md`'s meta characters: `/ & \ . * [ ] ^ $`.
const META_CHARACTER = /[/&\\.*[\]^$]/u
const SUBSTITUTE = 's'
const SUBSTITUTE_PARTS = 3
const ONE_MATCH = 1

interface SedCall {
	scripts: Array<string>
	files: Array<string>
}

function unquoted(word: string): string {
	return SURROUNDING_QUOTES.exec(word)?.[QUOTED_BODY] ?? word
}

function is_in_place_flag(word: string): boolean {
	return IN_PLACE_LONG.test(word) || IN_PLACE_SHORT.test(word)
}

// The words after the in-place flags: BSD's `-i ''` carries its suffix as the next (empty) word.
function without_suffix(words: ReadonlyArray<string>): Array<string> {
	const index = words.indexOf(BARE_IN_PLACE)

	if (index === -1 || words[index + 1] !== '') return [...words]

	return words.toSpliced(index + 1, 1)
}

function sed_words(segment: string): Array<string> | undefined {
	const words = git_argv.arguments_of(segment, SED)?.map((word) => unquoted(word))

	return words?.some((word) => is_in_place_flag(word)) === true ? without_suffix(words) : undefined
}

function is_script_value(words: ReadonlyArray<string>, index: number): boolean {
	return words[index - 1] === SCRIPT_FLAG
}

// The scripts (`-e <script>`, or the first operand without one) and the files of an in-place `sed`.
function sed_call(words: ReadonlyArray<string>): SedCall {
	const scripts = words.filter((_word, index) => is_script_value(words, index))
	const operands = words.filter(
		(word, index) => !word.startsWith(FLAG_PREFIX) && !is_script_value(words, index),
	)

	if (scripts.length > 0) return { scripts, files: operands }

	const [script, ...files] = operands

	return { scripts: script === undefined ? [] : [script], files }
}

// An `s` command split on its delimiter into the pattern, the replacement and the flags; `undefined`
// for any other script.
function substitute_parts(script: string): Array<string> | undefined {
	if (!script.startsWith(SUBSTITUTE)) return undefined

	const parts = script.slice(SUBSTITUTE.length + 1).split(script.charAt(SUBSTITUTE.length))

	return parts.length === SUBSTITUTE_PARTS ? parts : undefined
}

// `file-edits.md` condition 2 reads both sides: no meta character in the pattern or the replacement.
function is_plain([pattern = '', replacement = '']: ReadonlyArray<string>): boolean {
	return pattern !== '' && !META_CHARACTER.test(pattern) && !META_CHARACTER.test(replacement)
}

// The pattern of a single `s` command with no meta character; `undefined` for anything else.
function plain_pattern(scripts: ReadonlyArray<string>): string | undefined {
	const [script] = scripts

	if (script === undefined || scripts.length !== 1) return undefined

	const parts = substitute_parts(script)

	return parts !== undefined && is_plain(parts) ? parts[0] : undefined
}

function match_count(text: string, pattern: string): number {
	return text.split(pattern).length - 1
}

type ReadFile = (file_path: string) => string

// The trigger: an in-place `sed` the conditions do not clear in any of its target files.
function is_unsafe_segment(segment: string, read: ReadFile): boolean {
	const words = sed_words(segment)

	if (words === undefined) return false

	const { scripts, files } = sed_call(words)
	const pattern = plain_pattern(scripts)

	if (pattern === undefined || files.length === 0) return true

	return files.some((file) => match_count(read(file), pattern) !== ONE_MATCH)
}

function is_unsafe_sed(command: string, read: ReadFile = file_reader.read_file_or_empty): boolean {
	return shell_segments.segments_of(command).some((segment) => is_unsafe_segment(segment, read))
}

// The occasion the rule governs: any in-place `sed`.
function is_in_place_sed(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => sed_words(segment) !== undefined)
}

// Keeping the rule: an in-place `sed` whose script clears the static conditions. The per-file count
// is not re-read here, so a transcript is measured without the file as it stood then.
function keeps_plain_sed(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => {
		const words = sed_words(segment)

		return words !== undefined && plain_pattern(sed_call(words).scripts) !== undefined
	})
}

const SED_IN_PLACE_REASON =
	'⛔ unsafe `sed -i`: its pattern or replacement carries a meta character (`/ & \\ . * [ ] ^ $`), ' +
	'it is not one `s` command, or it does not match exactly once in each target file, so it can rewrite a line you did ' +
	'not mean to. Change the region with the Edit tool. This rule fires on every occurrence ' +
	'(`prompts/collaboration-workflow/file-edits.md`).'

const ROW = {
	id: 'sed-in-place',
	is_trigger: bash_triggers.on_bash_command((command: string) => is_unsafe_sed(command)),
	reason: SED_IN_PLACE_REASON,
	decide: (): boolean => true,
	keeps: bash_triggers.on_bash_command(keeps_plain_sed),
	reaches: bash_triggers.on_bash_command(is_in_place_sed),
	about: {
		title: 'No `sed -i` its countable conditions do not clear',
		topic: '`file-edits.md`',
		fires:
			'a `sed -i` whose script is not one `s` command, whose pattern or replacement has a meta character, or which does not match exactly once in a target file. Every occurrence',
		quiet: 'not in place, or one plain `s` command matching once in each file',
	},
}

const sed_in_place = {
	ROW,
	is_in_place_sed,
	is_unsafe_sed,
	keeps_plain_sed,
}

export { sed_in_place }
