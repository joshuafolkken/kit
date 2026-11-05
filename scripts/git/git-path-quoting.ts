const OCTAL_RADIX = 8
const OCTAL_WIDTH = 3
const SPACE_CODE = 32
const DELETE_CODE = 127
const ESCAPES: ReadonlyMap<string, string> = new Map([
	['\u{7}', 'a'],
	['\b', 'b'],
	['\t', 't'],
	['\n', 'n'],
	['\v', 'v'],
	['\f', 'f'],
	['\r', 'r'],
	['"', '"'],
	['\\', '\\'],
])

function escape_character(character: string): string {
	const short = ESCAPES.get(character)

	if (short !== undefined) return `\\${short}`
	const code = character.codePointAt(0) ?? 0

	return code === DELETE_CODE || code < SPACE_CODE
		? `\\${code.toString(OCTAL_RADIX).padStart(OCTAL_WIDTH, '0')}`
		: character
}

// Git's line-delimited output with core.quotePath=false still quotes control characters.
function quote(file: string): string {
	const escaped = Array.from(file, (character) => escape_character(character)).join('')

	return escaped === file ? file : `"${escaped}"`
}

function unescape_character(escaped: string): string {
	return (
		[...ESCAPES].find((entry) => entry[1] === escaped)?.[0] ??
		String.fromCodePoint(Number.parseInt(escaped, OCTAL_RADIX))
	)
}

function unquote(file: string): string {
	if (!file.startsWith('"') || !file.endsWith('"')) return file

	return file
		.slice(1, -1)
		.replaceAll(/\\([0-7]{3}|a|b|f|n|r|t|v|["\\])/gu, (_match, escaped: string) =>
			unescape_character(escaped),
		)
}

const git_path_quoting = { quote, unquote }

export { git_path_quoting }
