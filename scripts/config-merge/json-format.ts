// Serialize JSON config the way prettier would, so a file kit rewrites during `josh sync` stays
// `prettier --check`-clean. `JSON.stringify(value, undefined, '\t')` matches prettier everywhere
// EXCEPT one case: prettier keeps a short array of primitives on a single line when it fits within
// printWidth, whereas JSON.stringify always expands every non-empty array. We post-process the
// stringify output, collapsing exactly those arrays back inline — reusing JSON.stringify for all
// string escaping, number formatting, and key ordering so we never diverge on those. See
// joshuafolkken/kit#660 (a synced tsconfig `exclude` was emitted multi-line and failed prettier).
//
// Scope note: an OVER-width array is left one-element-per-line, which matches prettier for string
// arrays (the only kind these config files hold). prettier uses a packed "fill" layout only for
// over-width NUMBER arrays — a shape none of the managed JSON configs (tsconfig, package.json,
// .vscode/*) contain — so that one divergence is unreachable here and deliberately not replicated.

// Mirror the kit prettier preset: printWidth 100, tabs measured as 2 columns for width.
const PRINT_WIDTH = 100
const TAB_WIDTH = 2
const ARRAY_CLOSE = /^\t*\],?$/u

interface ArrayBlock {
	elements: ReadonlyArray<string>
	close: string
	end: number
}

// True when the line opens an array (`[` or `"key": [`). String / object opens never end in `[`.
function is_array_open(line: string): boolean {
	return line.endsWith('[')
}

// A block is inline-able only when every element line is a leaf scalar. A nested object / array
// (which prettier and JSON.stringify always break) opens on its own line ending in `{`/`[`, whereas
// a scalar line ends in a quote, digit, comma, or literal — so a string value that merely CONTAINS
// a bracket (e.g. the glob `"src/[abc]/*.ts"`) is still correctly treated as a leaf.
function is_leaf_element(line: string): boolean {
	return !line.endsWith('{') && !line.endsWith('[')
}

// Printed column width of a single line: leading tabs count as TAB_WIDTH columns each, the rest as
// one column per character (config JSON never mixes tabs into the non-indent portion of a line).
function line_width(line: string): number {
	const tabs = line.length - line.trimStart().length

	return tabs * TAB_WIDTH + (line.length - tabs)
}

// Flatten collected element lines into `[a, b, c]`, dropping each element's indentation and the
// trailing comma JSON.stringify placed between elements.
function flatten_elements(elements: ReadonlyArray<string>): string {
	const scalars = elements.map((line) => line.trim().replace(/,$/u, ''))

	return `[${scalars.join(', ')}]`
}

// Collect the element lines between an array-open at `start` and its matching close line. Returns
// undefined when any element is a nested structure (not inline-able) — the caller keeps it expanded.
function collect_block(lines: ReadonlyArray<string>, start: number): ArrayBlock | undefined {
	const close = lines.findIndex((line, index) => index > start && ARRAY_CLOSE.test(line))
	if (close === -1) return undefined
	const elements = lines.slice(start + 1, close)
	if (elements.some((line) => !is_leaf_element(line))) return undefined

	return { elements, close: lines[close] ?? '', end: close }
}

// Build the single-line form of an array block, or undefined when it would exceed printWidth (so
// the caller leaves it expanded, exactly as prettier would).
function try_inline(open: string, block: ArrayBlock): string | undefined {
	const trailing_comma = block.close.trimStart() === '],' ? ',' : ''
	const inlined = `${open.slice(0, -1)}${flatten_elements(block.elements)}${trailing_comma}`

	return line_width(inlined) <= PRINT_WIDTH ? inlined : undefined
}

interface Rewrite {
	lines: ReadonlyArray<string>
	next: number
}

// Render `line` (at `index`), collapsing it to one line when it opens a short primitive array;
// otherwise emit it verbatim. `next` is the index to resume from (past a collapsed block).
function rewrite_at(lines: ReadonlyArray<string>, index: number, line: string): Rewrite {
	const verbatim: Rewrite = { lines: [line], next: index + 1 }
	const block = is_array_open(line) ? collect_block(lines, index) : undefined
	if (block === undefined) return verbatim
	const inlined = try_inline(line, block)
	if (inlined === undefined) return verbatim

	return { lines: [inlined], next: block.end + 1 }
}

function inline_short_arrays(text: string): string {
	const lines = text.split('\n')
	const output: Array<string> = []
	let index = 0

	while (index < lines.length) {
		const rewrite = rewrite_at(lines, index, lines[index] ?? '')

		output.push(...rewrite.lines)
		index = rewrite.next
	}

	return output.join('\n')
}

// Prettier-clean replacement for `${JSON.stringify(value, undefined, '\t')}\n`.
function format_json(value: unknown): string {
	return `${inline_short_arrays(JSON.stringify(value, undefined, '\t'))}\n`
}

const json_format = {
	inline_short_arrays,
	format_json,
}

export { json_format }
