// Whether a reply is written in the session language (joshuafolkken/kit#2470). The session-language
// line reaches a turn only through `UserPromptSubmit`, so a turn opened by a background completion or a
// Stop hook refusal answered in whatever language it was just shown, and kept answering in it.
//
// **The check is by script, derived from the configured language rather than a hard-coded pair.**
// `Intl.Locale#maximize` names the script a language is written in (`ja` → `Jpan`, `en` → `Latn`,
// `ru` → `Cyrl`), so any configured value is judged the same way and none is special-cased. Two
// languages sharing one script (`en` and `fr`) are not told apart — the drift observed is a script
// change, and a statistical detector would misread prose interleaved with English identifiers.
//
// **Latin is the fallback script of a line.** Identifiers are Latin in every language's prose, so a
// Japanese line naming `Stop hook` is still Japanese; a line is Latin only when it carries no letter
// of another script.

const LATIN_SCRIPT = 'Latn'
// The compound scripts `maximize` returns, spelled as the Unicode scripts a regex can name.
const COMPOUND_SCRIPTS: Readonly<Record<string, ReadonlyArray<string>>> = {
	Jpan: ['Hira', 'Kana', 'Hani'],
	Kore: ['Hang', 'Hani'],
	Hans: ['Hani'],
	Hant: ['Hani'],
}

// Below this many letters of prose the reply is a command, a path or a one-word acknowledgement, and
// carries no language to judge.
const MIN_PROSE_LETTERS = 20
// The share of prose letters that must sit on lines in the session language. Weighed by letters, not
// lines, so a report's short English headings (`**Cause**`, `## Details`) do not outvote its prose.
const MATCH_SHARE_FLOOR = 0.5

const CODE_PATTERNS: ReadonlyArray<RegExp> = [
	/```[\s\S]*?(?:```|$)/gu,
	/`[^`\n]*`/gu,
	/\]\([^)\s]*\)/gu,
	/https?:\/\/\S+/gu,
]
const LETTER_PATTERN = /\p{L}/gu
// A letter of another script — `Common` and `Inherited` letters (`µ`) belong to no language of their own.
const NON_LATIN_LETTER_PATTERN = /(?![\p{Script=Latn}\p{Script=Common}\p{Script=Inherited}])\p{L}/u

function script_of(lang: string): string | undefined {
	try {
		return new Intl.Locale(lang).maximize().script
	} catch {
		return undefined
	}
}

// The letters of the session script, or `undefined` for a script this runtime's regex cannot name.
function letter_pattern(script: string): RegExp | undefined {
	const scripts = COMPOUND_SCRIPTS[script] ?? [script]
	const classes = scripts.map((name) => String.raw`\p{Script=${name}}`).join('')

	try {
		return new RegExp(`[${classes}]`, 'u')
	} catch {
		return undefined
	}
}

function prose_of(message: string): string {
	let text = message

	for (const pattern of CODE_PATTERNS) text = text.replaceAll(pattern, ' ')

	return text
}

function letter_count(text: string): number {
	return text.match(LETTER_PATTERN)?.length ?? 0
}

function is_line_in_script(line: string, script: string, pattern: RegExp): boolean {
	if (script === LATIN_SCRIPT) return !NON_LATIN_LETTER_PATTERN.test(line)

	return pattern.test(line)
}

function matches_share(prose: string, script: string, pattern: RegExp): number {
	const matched = prose.split('\n').filter((line) => is_line_in_script(line, script, pattern))

	return letter_count(matched.join('\n')) / letter_count(prose)
}

// `true` only when the reply has prose enough to judge and most of it is in another script. Every
// unanswerable case — an unknown language, a script with no regex, a code-only reply — reads as a match,
// because a false refusal costs a turn and a missed one costs nothing new.
function is_mismatch(message: string, lang: string): boolean {
	const script = script_of(lang)
	if (script === undefined) return false

	const pattern = letter_pattern(script)
	if (pattern === undefined) return false

	const prose = prose_of(message)
	if (letter_count(prose) < MIN_PROSE_LETTERS) return false

	return matches_share(prose, script, pattern) < MATCH_SHARE_FLOOR
}

const reply_language = { MIN_PROSE_LETTERS, is_mismatch, script_of }

export { reply_language }
