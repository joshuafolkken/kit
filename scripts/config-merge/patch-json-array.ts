import { findNodeAtLocation, getNodeValue, parseTree, type Node } from 'jsonc-parser'
import { json_format } from './json-format'
import { patch_json_key } from './patch-json-key'

type ElementMatcher = (element: unknown) => boolean

interface ElementUpsert {
	key: string
	value: unknown
	is_target: ElementMatcher
}

interface ArraySite {
	property: Node
	elements: ReadonlyArray<Node>
}

// `format_json({ [key]: [value] })` opens with `{` and `\t"key": [`, and closes with `\t]`, `}` and
// the empty string after the final newline; every line between them is the element.
const PROBE_HEAD_LINES = 2
const PROBE_TAIL_LINES = 3

function element_nodes(array: Node | undefined): ReadonlyArray<Node> {
	if (array?.type !== 'array') return []

	return array.children ?? []
}

// The top-level array `key` holds, when it has at least one element to anchor an edit to.
function find_array(content: string, key: string): ArraySite | undefined {
	const root = parseTree(content)
	const array = root === undefined ? undefined : findNodeAtLocation(root, [key])
	const elements = element_nodes(array)
	if (array?.parent === undefined || elements.length === 0) return undefined

	return { property: array.parent, elements }
}

// The element's text at the depth it occupies in the document — rendered inside a probe of the same
// shape, so prettier's printWidth decisions for its nested arrays are measured at that depth. The
// first line carries no indent: it is spliced in where the element's line already starts.
function render_element(content: string, site: ArraySite, upsert: ElementUpsert): string {
	const lines = json_format.format_json({ [upsert.key]: [upsert.value] }).split('\n')
	const text = lines.slice(PROBE_HEAD_LINES, -PROBE_TAIL_LINES).join('\n')
	const unit = patch_json_key.line_indent(content, site.property.offset)

	return patch_json_key.fit_value(content, text, unit).trimStart()
}

function splice(content: string, node: Node, length: number, text: string): string {
	return content.slice(0, node.offset) + text + content.slice(node.offset + length)
}

function append_element(content: string, last: Node, element_text: string): string {
	const indent = patch_json_key.line_indent(content, last.offset)
	const text = `,${patch_json_key.eol_of(content)}${indent}${element_text}`
	const end = { ...last, offset: last.offset + last.length }

	return splice(content, end, 0, text)
}

function is_equal(node: Node, value: unknown): boolean {
	return JSON.stringify(getNodeValue(node)) === JSON.stringify(value)
}

function upsert_in(content: string, site: ArraySite, upsert: ElementUpsert): string {
	const target = site.elements.find((element) => upsert.is_target(getNodeValue(element)))
	if (target !== undefined && is_equal(target, upsert.value)) return content
	const element_text = render_element(content, site, upsert)
	if (target !== undefined) return splice(content, target, target.length, element_text)
	const last = site.elements.at(-1)

	return last === undefined ? content : append_element(content, last, element_text)
}

// Replace the element `is_target` picks with `value`, or append `value` when none matches — touching
// only that one element's text. Rewriting the whole array, as `set_json_key` does, would drop every
// comment and hand-layout inside the elements the consumer owns. An element
// already equal to `value` is left byte-for-byte as authored; an absent or empty array is created.
function upsert_element(content: string, upsert: ElementUpsert): string {
	const site = find_array(content, upsert.key)
	if (site === undefined) return patch_json_key.set_json_key(content, upsert.key, [upsert.value])

	return upsert_in(content, site, upsert)
}

const patch_json_array = { upsert_element }

export type { ElementMatcher, ElementUpsert }
export { patch_json_array }
