import ts from 'typescript'
import { namespace_escape } from './namespace-escape'

// What a pass over the program found: the declaration nodes some reference resolved to, and the
// namespace declarations whose object escaped whole (`namespace-escape.ts`). A member counts as used
// once any reference resolves to it — a property access, a destructuring, a string-keyed access or a
// `vi.spyOn(namespace, 'member')` — however many hops of aliasing lie between, because the checker
// resolves `outer.inner.member` to the same property symbol `inner.member` does.
interface MemberUsage {
	used: Set<ts.Node>
	escaped: Set<ts.Node>
	// Each namespace declaration mapped to the declarations of the namespaces placed in its literal,
	// which escape whenever it does.
	nested: Map<ts.Node, Array<ts.Node>>
}

interface UsageScope {
	checker: ts.TypeChecker
	// The namespace declarations and literals being scanned, so an identifier is only resolved
	// further when it can name one of them.
	declarations: ReadonlySet<ts.Node>
	// Each namespace literal mapped to its declaration.
	literals: ReadonlyMap<ts.Node, ts.Node>
	usage: MemberUsage
}

function mark_symbol(symbol: ts.Symbol | undefined, usage: MemberUsage): void {
	const declarations = symbol?.declarations ?? []

	for (const declaration of declarations) usage.used.add(declaration)
}

function mark_property(scope: UsageScope, holder: ts.Node, name: string): void {
	mark_symbol(scope.checker.getTypeAtLocation(holder).getProperty(name), scope.usage)
}

function binding_property_name(element: ts.BindingElement): string | undefined {
	const name = element.propertyName ?? element.name

	return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

function mark_property_access(scope: UsageScope, node: ts.Node): void {
	if (ts.isPropertyAccessExpression(node)) {
		mark_symbol(scope.checker.getSymbolAtLocation(node.name), scope.usage)
	}
}

function mark_binding(scope: UsageScope, node: ts.Node): void {
	if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent)) return
	const name = binding_property_name(node)

	if (name !== undefined) mark_property(scope, node.parent, name)
}

function mark_element_access(scope: UsageScope, node: ts.Node): void {
	if (!ts.isElementAccessExpression(node)) return
	const argument = node.argumentExpression

	if (ts.isStringLiteralLike(argument)) mark_property(scope, node.expression, argument.text)
}

// `vi.spyOn(namespace, 'member')` names a member by string beside the object holding it.
function mark_call_arguments(scope: UsageScope, node: ts.Node): void {
	if (!ts.isCallExpression(node)) return

	node.arguments.forEach((argument, index) => {
		const holder = node.arguments[index - 1]

		if (holder !== undefined && ts.isStringLiteralLike(argument)) {
			mark_property(scope, holder, argument.text)
		}
	})
}

// The variable an identifier names, through an import or export alias. A shorthand property's name
// resolves to the property it declares, so its value is asked for separately.
function value_declaration(
	checker: ts.TypeChecker,
	identifier: ts.Identifier,
): ts.Node | undefined {
	const { parent } = identifier
	const symbol = ts.isShorthandPropertyAssignment(parent)
		? checker.getShorthandAssignmentValueSymbol(parent)
		: checker.getSymbolAtLocation(identifier)
	if (symbol === undefined) return undefined
	// eslint-disable-next-line no-bitwise -- symbol flags are a bit field; asking one bit is the API
	const is_alias = (symbol.flags & ts.SymbolFlags.Alias) !== 0

	return (is_alias ? checker.getAliasedSymbol(symbol) : symbol).valueDeclaration
}

// The identifier an expression names a value through: `ns` itself, or the member name of `outer.ns`.
function source_identifier(expression: ts.Expression | undefined): ts.Identifier | undefined {
	if (expression === undefined) return undefined
	const named = ts.isPropertyAccessExpression(expression) ? expression.name : expression

	return ts.isIdentifier(named) ? named : undefined
}

function declared_value(declaration: ts.Node): ts.Expression | undefined {
	const is_assigned = ts.isVariableDeclaration(declaration) || ts.isPropertyAssignment(declaration)

	return is_assigned ? declaration.initializer : undefined
}

// The identifier a declaration takes its whole value from, if that is all it does — a
// `const alias = ns` or `const alias = outer.ns`, or a member `{ ns }` / `{ key: ns }` of another
// namespace, which a reference to `outer.ns` resolves to.
function alias_source(declaration: ts.Node | undefined): ts.Identifier | undefined {
	if (declaration === undefined) return undefined
	if (ts.isShorthandPropertyAssignment(declaration)) return declaration.name

	return source_identifier(declared_value(declaration))
}

// The declaration an identifier names once every alias hop is followed, so the alias handed on whole
// escapes the namespace it holds. `seen` stops a cyclic initializer.
function namespace_declaration(
	checker: ts.TypeChecker,
	identifier: ts.Identifier,
): ts.Node | undefined {
	const seen = new Set<ts.Node>()
	let declaration = value_declaration(checker, identifier)
	let source = alias_source(declaration)

	while (source !== undefined && declaration !== undefined && !seen.has(declaration)) {
		seen.add(declaration)
		declaration = value_declaration(checker, source)
		source = alias_source(declaration)
	}

	return declaration
}

// The identifier a use of a namespace resolves from: a bare `ns`, or the member name of `outer.ns`,
// whose use is the whole access. The name inside an access is that access, not a use of its own.
function use_identifier(node: ts.Node): ts.Identifier | undefined {
	if (ts.isPropertyAccessExpression(node)) return source_identifier(node)
	if (!ts.isIdentifier(node)) return undefined
	const { parent } = node
	const is_access_name = ts.isPropertyAccessExpression(parent) && parent.name === node

	return is_access_name ? undefined : node
}

function used_namespace(scope: UsageScope, node: ts.Node): ts.Node | undefined {
	const identifier = use_identifier(node)
	if (identifier === undefined) return undefined
	const declaration = namespace_declaration(scope.checker, identifier)

	return declaration !== undefined && scope.declarations.has(declaration) ? declaration : undefined
}

function add_nested(usage: MemberUsage, outer: ts.Node, inner: ts.Node): void {
	usage.nested.set(outer, [...(usage.nested.get(outer) ?? []), inner])
}

function mark_escape(scope: UsageScope, node: ts.Node): void {
	const declaration = used_namespace(scope, node)
	if (declaration === undefined || namespace_escape.is_contained(node)) return
	const outer = namespace_escape.enclosing_namespace(node, scope.literals)

	if (outer === undefined) scope.usage.escaped.add(declaration)
	else add_nested(scope.usage, outer, declaration)
}

// An escaped namespace hands on every namespace placed in it, however deep, so each escapes too.
function propagate_escape(usage: MemberUsage): void {
	const pending = [...usage.escaped]

	for (let outer = pending.pop(); outer !== undefined; outer = pending.pop()) {
		const fresh = (usage.nested.get(outer) ?? []).filter((inner) => !usage.escaped.has(inner))

		for (const inner of fresh) usage.escaped.add(inner)
		pending.push(...fresh)
	}
}

// Each marker asks of the node whether it is its kind, so one pass hands every node to all of them.
const MARKERS: ReadonlyArray<(scope: UsageScope, node: ts.Node) => void> = [
	mark_property_access,
	mark_element_access,
	mark_binding,
	mark_call_arguments,
	mark_escape,
]

function mark_node(scope: UsageScope, node: ts.Node): void {
	for (const mark of MARKERS) mark(scope, node)
}

function collect_usage(
	scope: Omit<UsageScope, 'usage'>,
	sources: ReadonlyArray<ts.SourceFile>,
): MemberUsage {
	const usage: MemberUsage = { used: new Set(), escaped: new Set(), nested: new Map() }
	const full_scope: UsageScope = { ...scope, usage }

	function visit(node: ts.Node): void {
		mark_node(full_scope, node)
		ts.forEachChild(node, visit)
	}

	for (const source of sources) visit(source)
	propagate_escape(usage)

	return usage
}

const member_usage = { collect_usage }

export type { MemberUsage, UsageScope }
export { member_usage }
