import { createScanner, findNodeAtLocation, getNodeValue, parseTree, type Node } from 'jsonc-parser'
import strip_json_comments from 'strip-json-comments'
import { json_format } from './json-format'

// Set or remove one top-level key while leaving every other byte of the document alone.
//
// The merges kit runs against a consumer's `tsconfig.json` / `.vscode/*.json` used to read with a
// tolerant JSONC parse and write the whole file back from the parsed object, which silently deleted
// the consumer's comments — including the `// Path aliases are handled by ...` block `sv create`
// ships. Editing text in place instead keeps comments, trailing commas, key order and any
// hand-formatting outside the one value being changed. See joshuafolkken/kit#798.
//
// jsonc-parser is used ONLY to locate text, never to produce it. Two independent reasons:
//
//  1. Its formatter breaks every array one element per line regardless of width — the layout
//     prettier wants for `package.json`, and the opposite of what it wants for the files edited
//     here, where the `json` printer keeps a short array inline. Letting it render would
//     re-introduce joshuafolkken/kit#797 on a new axis.
//  2. `modify` with `formattingOptions` reformats a region around its edit, not just the edit —
//     removing `compilerOptions` from a document also expanded the untouched `extends` array above
//     it. Dropping `formattingOptions` avoids that but then places inserted keys with no newline or
//     indent at all. Neither setting does what is wanted, so placement is computed here from node
//     offsets, which is exact and touches nothing else.

const DOCUMENT_SUFFIX = '\n}\n'
const DEFAULT_INDENT = '\t'
const LEADING_BLANKS = /^[\t ]*/u
// Step back past the newline that ENDS the previous line, so the search finds the one before it.
const PREVIOUS_LINE_OFFSET = 2
const CRLF = '\r\n'

// Any scalar works — the probe entry is sliced away, only the comma it forces onto our line matters.
const COMMA_PROBE_VALUE = 0

interface TextRange {
	offset: number
	length: number
}

// The text `value` takes as a top-level key's value. Serializing a probe document and slicing the
// value out of it keeps prettier's inline-vs-broken decision — and its printWidth accounting,
// because the key sits at exactly the depth it will occupy in the real file.
//
// `has_trailing_comma` is not a detail: a key that is not last is followed by a comma, and that one
// column decides borderline lines. Measuring without it emitted a 101-column `extends` array inline
// that prettier then broke, failing the consumer's `prettier --check` on a file kit had just written.
function render_value(key: string, value: unknown, has_trailing_comma: boolean): string {
	// A second key for the probe document, derived from the real one by appending a space so it can
	// never equal it. A fixed sentinel would need an argument about why no config uses that name;
	// this needs none, and a collision would corrupt the slice arithmetic silently.
	const probe_key = `${key} `
	const probe = has_trailing_comma
		? { [key]: value, [probe_key]: COMMA_PROBE_VALUE }
		: { [key]: value }
	const document = json_format.format_json(probe)
	const prefix = `{\n\t${JSON.stringify(key)}: `
	const suffix = has_trailing_comma
		? `,\n\t${JSON.stringify(probe_key)}: ${String(COMMA_PROBE_VALUE)}${DOCUMENT_SUFFIX}`
		: DOCUMENT_SUFFIX

	return document.slice(prefix.length, document.length - suffix.length)
}

function parse_root(content: string): Node | undefined {
	const root = parseTree(content)

	return root?.type === 'object' ? root : undefined
}

function replace_range(content: string, range: TextRange, text: string): string {
	return content.slice(0, range.offset) + text + content.slice(range.offset + range.length)
}

function insert_at(content: string, offset: number, text: string): string {
	return replace_range(content, { offset, length: 0 }, text)
}

// Re-indent a rendered value for a document that does not indent with tabs. `render_value` always
// emits tabs, since it goes through the kit-preset serializer, so splicing a multi-line value into a
// space-indented file produced mixed indentation that the consumer's own prettier then rewrote — the
// file kit had just written failed their format check. The value's first line carries no indent of
// its own, so only continuation lines are rewritten: one unit per tab of depth.
function render_indent(value_text: string, unit: string): string {
	if (unit === DEFAULT_INDENT || unit.length === 0) return value_text

	return value_text.replaceAll(/^\t+/gmu, (tabs) => unit.repeat(tabs.length))
}

// The line ending the document already uses, so text spliced into a CRLF checkout does not leave the
// file with mixed endings. The whole-file serializer this replaced always produced a uniform file.
function eol_of(content: string): string {
	return content.includes(CRLF) ? CRLF : '\n'
}

// Lay a rendered value out for THIS document: its indent unit and its line ending. `format_json`
// always emits tabs and LF, so a value that breaks across lines would otherwise arrive with both
// wrong in a space-indented or CRLF file — leaving mixed indentation or mixed endings in a file the
// consumer never touched.
function fit_value(content: string, value_text: string, indent: string): string {
	const indented = render_indent(value_text, indent)
	if (eol_of(content) === '\n') return indented

	return indented.split('\n').join(CRLF)
}

// The whitespace opening the line `offset` sits on, so an inserted key lines up with its siblings
// whatever the document indents with.
function line_indent(content: string, offset: number): string {
	const line_start = content.lastIndexOf('\n', offset - 1) + 1

	return LEADING_BLANKS.exec(content.slice(line_start, offset))?.[0] ?? ''
}

// Index of the line's terminator, before the `\r` of a CRLF pair so text appended here does not land
// between the two characters and produce `\r\r\n`.
function line_end(content: string, offset: number): number {
	const index = content.indexOf('\n', offset)
	if (index === -1) return content.length

	return index > offset && content[index - 1] === '\r' ? index - 1 : index
}

function render_property(content: string, key: string, value_text: string, indent: string): string {
	return `${JSON.stringify(key)}: ${fit_value(content, value_text, indent)}`
}

// Where the new property's line starts: after the last property's line, but never past the object's
// own `}` — a single-line document has no newline before it, so the end-of-line search would
// otherwise run to the end of the file and insert outside the object.
function insertion_offset(content: string, root: Node, value_end: number): number {
	return Math.min(line_end(content, value_end), root.offset + root.length - 1)
}

// Offset of the separator comma after `offset`, or -1 when the next thing is not one. The scanner
// (with trivia ignored) skips whitespace AND comments, so a `,` written inside a comment is never
// mistaken for a separator; its position is read rather than its token kind, because `SyntaxKind` is
// an ambient const enum this project cannot import.
function separator_offset(content: string, offset: number, limit: number): number {
	const scanner = createScanner(content, true)

	scanner.setPosition(offset)
	scanner.scan()
	const at = scanner.getTokenOffset()

	return at < limit && content[at] === ',' ? at : -1
}

// JSONC allows a trailing comma after the last property, and `parse_jsonc` accepts one, so appending
// another would produce `,,` and leave a file nothing can read.
function has_separator_after(content: string, offset: number, limit: number): boolean {
	return separator_offset(content, offset, limit) !== -1
}

function property_key(property: Node): string | undefined {
	const key: unknown = property.children?.[0]?.value

	return typeof key === 'string' ? key : undefined
}

function target_value_end(property: Node | undefined): number | undefined {
	const value_node = property?.children?.[1]

	return value_node === undefined ? undefined : value_node.offset + value_node.length
}

// Whether the span holds a comment. `strip_json_comments` blanks comments while preserving length
// and is string-aware, so a `//` inside a string value is not counted — a scanner-based check would
// need `SyntaxKind`, which is an ambient const enum this project cannot import.
function contains_comment(content: string, node: Node): boolean {
	const text = content.slice(node.offset, node.offset + node.length)

	return strip_json_comments(text) !== text
}

// Re-lay-out a property whose trailing comma has just appeared or disappeared. That one column
// decides borderline lines: gaining it can push an inlined value past printWidth, losing it can let a
// broken one fit again. Either way prettier would rewrite the line, in a file kit had just written.
//
// Skipped entirely when the value holds a comment. Re-rendering serializes the value back from its
// parsed form, which would delete that comment — the defect this module exists to fix, reappearing on
// its own repair path — and a value the consumer commented is one kit should not be re-laying-out.
function rebalanced_value(
	content: string,
	key: string,
	value_node: Node,
	has_trailing_comma: boolean,
): string | undefined {
	if (contains_comment(content, value_node)) return undefined
	const indent = line_indent(content, value_node.offset)
	const rendered = fit_value(
		content,
		render_value(key, getNodeValue(value_node), has_trailing_comma),
		indent,
	)
	const current = content.slice(value_node.offset, value_node.offset + value_node.length)

	return rendered === current ? undefined : rendered
}

function rebalance(content: string, property: Node, has_trailing_comma: boolean): string {
	const key = property_key(property)
	const value_node = property.children?.[1]
	if (key === undefined || value_node === undefined) return content
	const rendered = rebalanced_value(content, key, value_node, has_trailing_comma)

	return rendered === undefined ? content : replace_range(content, value_node, rendered)
}

// Append after the last property, mirroring the key order the whole-file serializer produced (a
// spread puts a new key last). An empty object has no sibling to copy, so it gets one tab.
//
// Two insertions rather than one: the comma goes right after the last value, but the new property
// goes after the END OF THAT LINE. Putting both at the value would slide the new key in front of a
// trailing `// ...` comment on that line, silently re-attaching the consumer's note to a key kit
// generated. Later offset first, so the earlier one stays valid.
function append_after(content: string, root: Node, last: Node, property: string): string {
	const value_end = last.offset + last.length
	const closing_brace = root.offset + root.length - 1
	const separator = has_separator_after(content, value_end, closing_brace) ? '' : ','
	const with_property = insert_at(content, insertion_offset(content, root, value_end), property)

	return insert_at(with_property, value_end, separator)
}

// Insert the first property of an otherwise empty object, just inside its closing brace rather than
// by rewriting the braces — a body holding nothing but a comment keeps that comment.
function insert_only_property(content: string, root: Node, property: string): string {
	const closing_brace = root.offset + root.length - 1
	const lead = content[closing_brace - 1] === '\n' ? '' : eol_of(content)

	return insert_at(content, closing_brace, `${lead}${DEFAULT_INDENT}${property}${eol_of(content)}`)
}

function insert_property(content: string, root: Node, key: string, value_text: string): string {
	const last = root.children?.at(-1)

	if (last === undefined) {
		const only = render_property(content, key, value_text, DEFAULT_INDENT)

		return insert_only_property(content, root, only)
	}

	const indent = line_indent(content, last.offset)
	const property = `${eol_of(content)}${indent}${render_property(content, key, value_text, indent)}`

	return rebalance(append_after(content, root, last, property), last, true)
}

// A comment closing a property's line annotates that property. `end` walks past one so a removed key
// takes its own note with it — and, applied to the PREVIOUS key's line, so the span does not start
// before that key's note and delete a comment belonging to a property that is staying.
// Only the `//` form is recognized; a `/* ... */` block above or beside a key is left in place.
function end_of_trailing_comment(content: string, end: number): number {
	const stop = line_end(content, end)

	return content.slice(end, stop).trimStart().startsWith('//') ? stop : end
}

// Walk back over whole-line `//` comments immediately above `line_start`. They document the key being
// removed, so they go with it; leaving them would re-attach the note to whichever key follows.
function start_of_leading_comments(content: string, line_start: number, floor: number): number {
	let start = line_start

	while (start > floor) {
		const previous = content.lastIndexOf('\n', start - PREVIOUS_LINE_OFFSET) + 1
		const is_comment_line = content.slice(previous, start).trimStart().startsWith('//')

		if (!is_comment_line || previous < floor) return start

		start = previous
	}

	return start
}

function end_of_line_break(content: string, offset: number): number {
	if (content[offset] === '\r' && content[offset + 1] === '\n') return offset + PREVIOUS_LINE_OFFSET

	return content[offset] === '\n' ? offset + 1 : offset
}

// The text the removed property occupies: its own line when it has one (leading comment lines and
// trailing note included, so nothing is stranded or re-attributed), otherwise just the property.
function body_range(content: string, root: Node, target: Node, separator_limit: number): TextRange {
	const value_end = target.offset + target.length
	const comma = separator_limit === -1 ? -1 : separator_offset(content, value_end, separator_limit)
	const end = end_of_trailing_comment(content, comma === -1 ? value_end : comma + 1)
	const line_start = content.lastIndexOf('\n', target.offset - 1) + 1
	const is_own_line = content.slice(line_start, target.offset).trim().length === 0
	if (!is_own_line) return { offset: target.offset, length: end - target.offset }
	const start = start_of_leading_comments(content, line_start, root.offset + 1)

	return { offset: start, length: end_of_line_break(content, end) - start }
}

// Delete the property together with exactly one separator comma — never two, or the surviving keys stop
// being separated at all.
//
// While a next sibling exists the comma taken is the one AFTER the property, so the whole line goes
// as a unit and the comma still separating the keys on either side is the one that was already
// there. Only the last property has no comma after it; that case reaches back for the one before,
// as a SEPARATE span, because the previous key's own trailing note can sit between that comma and
// this property and a single span would delete a comment belonging to a property that is staying.
function ranges_for_last_property(
	content: string,
	root: Node,
	previous: Node,
	target: Node,
): ReadonlyArray<TextRange> {
	const comma = separator_offset(content, previous.offset + previous.length, target.offset)
	const body = body_range(content, root, target, -1)

	return comma === -1 ? [body] : [{ offset: comma, length: 1 }, body]
}

function removal_ranges(content: string, root: Node, index: number): ReadonlyArray<TextRange> {
	const children = root.children ?? []
	const target = children[index]
	if (target === undefined) return []
	const next = children[index + 1]
	if (next !== undefined) return [body_range(content, root, target, next.offset)]
	const previous = children[index - 1]
	if (previous === undefined) return [{ offset: root.offset, length: root.length }]

	return ranges_for_last_property(content, root, previous, target)
}

function property_index(root: Node, key: string): number {
	return (root.children ?? []).findIndex((child) => child.children?.[0]?.value === key)
}

// The single normalization these edits still perform. Preserving the document byte for byte would
// mean writing back a file with no final newline when the consumer's had none — git, POSIX tools and
// prettier all want one, and it is one byte at EOF rather than a reformat of anything the consumer
// wrote. Every managed config kit has ever written ended with exactly one.
function with_trailing_newline(content: string): string {
	return content.endsWith('\n') ? content : `${content}\n`
}

// True when a comma follows this key, i.e. it is not the last property in its object.
function is_followed_by_comma(content: string, root: Node, key: string): boolean {
	const children = root.children ?? []
	const index = property_index(root, key)
	if (index < 0) return false
	if (index < children.length - 1) return true
	const value_end = target_value_end(children[index])

	// The last property may still carry a JSONC trailing comma the consumer wrote.
	return (
		value_end !== undefined && has_separator_after(content, value_end, root.offset + root.length)
	)
}

function set_json_key(content: string, key: string, value: unknown): string {
	const root = parse_root(content)
	if (root === undefined) return content
	const existing = findNodeAtLocation(root, [key])
	// An inserted key is appended last, so nothing follows it.
	const value_text = render_value(
		key,
		value,
		existing !== undefined && is_followed_by_comma(content, root, key),
	)

	if (existing === undefined) {
		return with_trailing_newline(insert_property(content, root, key, value_text))
	}

	const indented = fit_value(content, value_text, line_indent(content, existing.offset))

	return with_trailing_newline(replace_range(content, existing, indented))
}

// The object a path's final segment lives in: the document root for a top-level key, otherwise the
// nested object addressed by everything before it.
function resolve_parent(content: string, path: ReadonlyArray<string>): Node | undefined {
	const root = parse_root(content)
	if (root === undefined) return undefined
	const parent = path.length > 1 ? findNodeAtLocation(root, path.slice(0, -1)) : root

	return parent?.type === 'object' ? parent : undefined
}

// Later spans first, so the offsets of the earlier ones stay valid. A span covering the whole object
// means its last property went, leaving `{}` behind; every other span simply disappears.
function cut_ranges(content: string, parent: Node, ranges: ReadonlyArray<TextRange>): string {
	const ordered = ranges.toSorted((left, right) => right.offset - left.offset)
	let next = content

	for (const range of ordered) {
		next = replace_range(next, range, range.offset === parent.offset ? '{}' : '')
	}

	return next
}

// Removing the LAST property strips the comma from the one before it, which now ends the object. The
// insert path re-lays-out a property that GAINS a comma for the same reason: one column decides
// borderline lines, and here it is given back, so a value broken across lines may fit inline again.
function rebalance_new_last(content: string, path: ReadonlyArray<string>): string {
	const parent = resolve_parent(content, path)
	const last = parent?.children?.at(-1)
	if (parent === undefined || last === undefined) return content

	return rebalance(content, last, has_separator_after(content, parent.offset, parent.offset))
}

// Delete one property, addressed by a path so a key nested inside another object can go on its own.
// That granularity is the point: pruning two redundant entries out of `compilerOptions` by replacing
// the whole block would take the consumer's comments inside it along with them.
function cut_property(content: string, parent: Node, path: ReadonlyArray<string>): string {
	const index = property_index(parent, path.at(-1) ?? '')
	const ranges = removal_ranges(content, parent, index)
	if (ranges.length === 0) return content
	const cut = cut_ranges(content, parent, ranges)
	const did_end_object = index === (parent.children ?? []).length - 1

	return did_end_object ? rebalance_new_last(cut, path) : cut
}

function remove_json_path(content: string, path: ReadonlyArray<string>): string {
	const parent = resolve_parent(content, path)
	if (parent === undefined) return content
	const next = cut_property(content, parent, path)

	return next === content ? content : with_trailing_newline(next)
}

function remove_json_key(content: string, key: string): string {
	return remove_json_path(content, [key])
}

const patch_json_key = {
	set_json_key,
	remove_json_key,
	remove_json_path,
}

export { patch_json_key }
