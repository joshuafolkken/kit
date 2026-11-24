// SGR runs reduced to the style they leave (joshuafolkken/kit#8826): the foreground, the background,
// the underline color and each attribute held once, so a run that sets a color after resetting it,
// character after character, names the same style as one that set it once instead of a longer one.
// The style is written back as one SGR sequence per part, in the order the parts were first set.

const ESC = '\u{1B}'
const SEPARATOR = ';'
const SUB_SEPARATOR = ':'
const RESET = '0'
// 38 / 48 / 58 take the color after them: `2;r;g;b` or `5;n`.
const EXTENDED = new Set(['38', '48', '58'])
const RGB = '2'
const RGB_LENGTH = 5
const INDEXED_LENGTH = 3
const FOREGROUND = /^(?:3[0-8]|9[0-7])$/u
const BACKGROUND = /^(?:4[0-8]|10[0-7])$/u
const UNDERLINE_COLOR = '58'
const FOREGROUND_PART = 'foreground'
const BACKGROUND_PART = 'background'
const UNDERLINE_COLOR_PART = 'underline color'
const UNDERLINE = '4'
// The parts each code clears: a reset all of them, a closing code the ones it closes.
const ALL: ReadonlyArray<string> = []
const CLEARS: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
	['', ALL],
	[RESET, ALL],
	['21', [UNDERLINE]],
	['22', ['1', '2']],
	['23', ['3']],
	['24', [UNDERLINE]],
	['25', ['5', '6']],
	['27', ['7']],
	['28', ['8']],
	['29', ['9']],
	['39', [FOREGROUND_PART]],
	['49', [BACKGROUND_PART]],
	['59', [UNDERLINE_COLOR_PART]],
])

// Each part's SGR parameters, by the part they set.
type SgrParts = Map<string, string>

function group_length(parts: ReadonlyArray<string>, at: number): number {
	if (!EXTENDED.has(parts[at] ?? '')) return 1

	return parts[at + 1] === RGB ? RGB_LENGTH : INDEXED_LENGTH
}

// `parameters` split into one group per code, a color code with the color after it.
function groups_of(parameters: string): Array<Array<string>> {
	const parts = parameters.split(SEPARATOR)
	const groups: Array<Array<string>> = []

	for (let at = 0; at < parts.length; at += groups.at(-1)?.length ?? 1) {
		groups.push(parts.slice(at, at + group_length(parts, at)))
	}

	return groups
}

function part_of(code: string): string {
	if (FOREGROUND.test(code)) return FOREGROUND_PART
	if (BACKGROUND.test(code)) return BACKGROUND_PART

	return code === UNDERLINE_COLOR ? UNDERLINE_COLOR_PART : code
}

function clear(parts: SgrParts, clears: ReadonlyArray<string>): void {
	if (clears === ALL) parts.clear()
	for (const part of clears) parts.delete(part)
}

function apply_group(parts: SgrParts, group: ReadonlyArray<string>): void {
	const [code = ''] = (group[0] ?? '').split(SUB_SEPARATOR)
	const clears = CLEARS.get(code)

	if (clears === undefined) parts.set(part_of(code), group.join(SEPARATOR))
	else clear(parts, clears)
}

// `parts` after the SGR sequence with `parameters`.
function apply(parts: SgrParts, parameters: string): void {
	for (const group of groups_of(parameters)) apply_group(parts, group)
}

// The style `parts` hold, as SGR sequences; '' for the default.
function text_of(parts: SgrParts): string {
	return [...parts.values()].map((parameters) => `${ESC}[${parameters}m`).join('')
}

// The parts a style written by `text_of` holds, each set again in its order.
function parts_of(style: string): SgrParts {
	const parts: SgrParts = new Map()

	for (const sequence of style.split(`${ESC}[`).slice(1)) apply(parts, sequence.slice(0, -1))

	return parts
}

// joshuafolkken/kit#8826: a frame paints the same few styles over and over, so each step from a style
// is reduced once. Forgotten whole past `KNOWN_STEPS`, so styles that never come back cannot pile up.
const KNOWN_STEPS = 4096
const steps = new Map<string, string>()

// The style `style` (as `text_of` writes it) leaves after the SGR sequence with `parameters`.
function after(style: string, parameters: string): string {
	const key = `${style}\u{0}${parameters}`
	const known = steps.get(key)

	if (known !== undefined) return known
	const parts = parts_of(style)

	apply(parts, parameters)
	const next = text_of(parts)

	if (steps.size >= KNOWN_STEPS) steps.clear()
	steps.set(key, next)

	return next
}

const run_board_sgr = { after }

export { run_board_sgr }
