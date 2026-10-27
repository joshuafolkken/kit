import type { TypeScriptApi } from '#scripts/review/comment-ranges'
import type { Identifier, Node } from 'typescript'
import { test_pinned_functions } from './test-pinned-functions'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'

// Which hunks `josh test:pinned` does not probe as a rewire (joshuafolkken/kit#5235): an import moved
// to another module under a new name, or a call renamed to it. Put back alone, such a hunk reads a name
// nothing in the file binds, so a test goes red exactly when it runs that line — the hunk has no
// behavior of its own to pin. A hunk that changes anything besides the names is still probed.

interface Names {
	bound: Set<string>
	used: Set<string>
	imported: Set<string>
}

interface Token {
	kind: number
	text: string
}

function is_called(api: TypeScriptApi, parent: Node, node: Identifier): boolean {
	if (!api.isCallExpression(parent) && !api.isNewExpression(parent)) return false

	return parent.expression === node || parent.arguments?.some((item) => item === node) === true
}

// A read of the name's value: the object of a member access, a callee or an argument. Any other
// position is left out, so a name read elsewhere never makes a hunk a rewire.
function is_use(api: TypeScriptApi, node: Identifier): boolean {
	const { parent } = node
	if (api.isPropertyAccessExpression(parent)) return parent.expression === node

	return is_called(api, parent, node)
}

function is_import(api: TypeScriptApi, parent: Node): boolean {
	return (
		api.isImportSpecifier(parent) || api.isImportClause(parent) || api.isNamespaceImport(parent)
	)
}

// Any node's own name counts as bound — a property name too — so a binding is never missed.
function add_name(api: TypeScriptApi, node: Identifier, names: Names): void {
	const { parent } = node
	if (is_use(api, node)) names.used.add(node.text)
	if (!('name' in parent) || parent.name !== node) return
	names.bound.add(node.text)
	if (is_import(api, parent)) names.imported.add(node.text)
}

function names_in(api: TypeScriptApi, node: Node, names: Names): void {
	if (api.isIdentifier(node)) add_name(api, node, names)
	api.forEachChild(node, (child) => {
		names_in(api, child, names)
	})
}

function names_of(api: TypeScriptApi, file: string, content: string): Names {
	const names = { bound: new Set<string>(), used: new Set<string>(), imported: new Set<string>() }

	names_in(api, api.createSourceFile(file, content, api.ScriptTarget.ESNext, true), names)

	return names
}

// The names read and bound nowhere in the file, globals left out.
function unbound_of(names: Names): Array<string> {
	return [...names.used].filter(
		(name) => !names.bound.has(name) && !Object.hasOwn(globalThis, name),
	)
}

function tokens_of(api: TypeScriptApi, text: string): Array<Token> {
	const target = api.ScriptTarget.ESNext
	const scanner = api.createScanner(target, true, api.LanguageVariant.Standard, text)
	const end = api.SyntaxKind.EndOfFileToken
	const tokens: Array<Token> = []

	for (let kind = scanner.scan(); kind !== end; kind = scanner.scan()) {
		tokens.push({ kind, text: scanner.getTokenText() })
	}

	return tokens
}

// A rename the revert undoes: from a name it leaves unbound to one the file imports now.
interface Swap {
	from: ReadonlySet<string>
	to: ReadonlySet<string>
}

function is_same_token(token: Token, other: Token | undefined, swap: Swap): boolean {
	if (other?.kind !== token.kind) return false

	return token.text === other.text || (swap.from.has(token.text) && swap.to.has(other.text))
}

// Whether two token runs differ only where `swap` renames the old token to the new one.
function is_renamed_only(
	olds: ReadonlyArray<Token>,
	news: ReadonlyArray<Token>,
	swap: Swap,
): boolean {
	if (olds.length !== news.length) return false

	return olds.every((token, index) => is_same_token(token, news[index], swap))
}

function is_import_only(api: TypeScriptApi, file: string, text: string): boolean {
	const source = api.createSourceFile(file, text, api.ScriptTarget.ESNext, true)

	return source.statements.every((statement) => api.isImportDeclaration(statement))
}

function new_text_of(content: string, hunk: Hunk): string {
	const start = hunk.new_start - 1

	return content
		.split('\n')
		.slice(start, start + hunk.new_count)
		.join('\n')
}

// The hunk's lines are import declarations alone, or the same code with only the names swapped.
function is_name_swap(api: TypeScriptApi, hunk: Hunk, new_text: string, swap: Swap): boolean {
	const old_text = hunk.old_lines.join('\n')
	const is_imports = is_import_only(api, hunk.file, old_text)
	if (is_imports && is_import_only(api, hunk.file, new_text)) return true

	return is_renamed_only(tokens_of(api, old_text), tokens_of(api, new_text), swap)
}

function is_rewire(api: TypeScriptApi, content: string, hunk: Hunk): boolean {
	if (!test_pinned_functions.is_script(hunk.file)) return false
	const after = names_of(api, hunk.file, content)
	const before = names_of(api, hunk.file, test_pinned_logic.revert(content, hunk))
	const unbound_now = new Set(unbound_of(after))
	const unbound = unbound_of(before).filter((name) => !unbound_now.has(name))
	if (unbound.length === 0) return false
	const swap = { from: new Set(unbound), to: after.imported }

	return is_name_swap(api, hunk, new_text_of(content, hunk), swap)
}

const test_pinned_rewire = { is_rewire }

export { test_pinned_rewire }
