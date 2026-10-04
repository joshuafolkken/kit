import { json_object_schema } from '#scripts/lib/schemas'
import { parseTree, printParseErrorCode, type Node, type ParseError } from 'jsonc-parser'

// Every managed JSON config kit reads (tsconfig.json, package.json, .vscode/*.json) may legally
// carry comments and trailing commas — TypeScript and VS Code both parse them as JSONC — so a plain
// `JSON.parse` would throw on files consumers hand-authored. Single-sourced here because the
// config-merge library and the init/sync merge helpers both need the exact same tolerant read.

// Built from the tree rather than with jsonc-parser's own `parse` / `getNodeValue`, which assign each
// key: a `"__proto__"` key would become the object's prototype instead of the own property
// `JSON.parse` keeps, and the spread-and-stringify write-back would then drop it from the file.
// `Object.fromEntries` defines properties, so every key stays data.
function property_key(property: Node): string {
	return String(property.children?.[0]?.value)
}

function node_value(node: Node | undefined): unknown {
	if (node === undefined) return undefined
	const children = node.children ?? []
	if (node.type === 'array') return children.map((child) => node_value(child))
	if (node.type !== 'object') return node.value

	return Object.fromEntries(
		children.map((property) => [property_key(property), node_value(property.children?.[1])]),
	)
}

// jsonc-parser recovers from errors and returns a best-effort tree, so any reported error is
// rethrown: a malformed document must fail the read the way `JSON.parse` would, not merge partially.
function parse_jsonc(content: string): Record<string, unknown> {
	const errors: Array<ParseError> = []
	const tree = parseTree(content, errors, { allowTrailingComma: true })
	const [first_error] = errors

	if (first_error !== undefined) {
		throw new SyntaxError(
			`Invalid JSONC: ${printParseErrorCode(first_error.error)} at offset ${String(first_error.offset)}`,
		)
	}

	return json_object_schema.parse(node_value(tree))
}

export { parse_jsonc }
