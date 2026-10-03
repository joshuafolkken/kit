import ts from 'typescript'

// A namespace *escapes* when the object itself, not one of its members, is handed somewhere — spread
// into another object, passed as a value, returned, re-exported. From there any member may be read
// in a way no reference names, so every member of an escaped namespace counts as used. The uses below
// keep the object contained: each either names a member the checker resolves (`ns.member`,
// `ns['member']`, `vi.spyOn(ns, 'member')`) or moves the object along a path whose type still points
// at the original members (an alias, an import, a member of another namespace).
type ContainedUse = (identifier: ts.Node, parent: ts.Node) => boolean

// A computed key (`ns[name]`) can read any member, so only a literal one keeps the object contained.
function is_accessed(identifier: ts.Node, parent: ts.Node): boolean {
	if (ts.isPropertyAccessExpression(parent)) return parent.expression === identifier

	return (
		ts.isElementAccessExpression(parent) &&
		parent.expression === identifier &&
		ts.isStringLiteralLike(parent.argumentExpression)
	)
}

function is_declared_or_aliased(_identifier: ts.Node, parent: ts.Node): boolean {
	return ts.isVariableDeclaration(parent) || ts.isTypeQueryNode(parent)
}

function is_imported(_identifier: ts.Node, parent: ts.Node): boolean {
	return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
}

// `export { ns }` is the namespace's own declaration; `export { ns } from` hands it on.
function is_local_export(_identifier: ts.Node, parent: ts.Node): boolean {
	return ts.isExportSpecifier(parent) && parent.parent.parent.moduleSpecifier === undefined
}

function is_spied_holder(identifier: ts.Node, parent: ts.Node): boolean {
	if (!ts.isCallExpression(parent)) return false
	const index = parent.arguments.findIndex((argument) => argument === identifier)
	const next = parent.arguments[index + 1]

	return index !== -1 && next !== undefined && ts.isStringLiteralLike(next)
}

const CONTAINED_USES: ReadonlyArray<ContainedUse> = [
	is_accessed,
	is_declared_or_aliased,
	is_imported,
	is_local_export,
	is_spied_holder,
]

function is_contained(identifier: ts.Node): boolean {
	const { parent } = identifier

	return CONTAINED_USES.some((is_contained_use) => is_contained_use(identifier, parent))
}

// A namespace placed as a member of another namespace literal is reached through that one's members,
// so it escapes only when that one does. `namespace_literals` maps each literal to its declaration;
// the declaration of the enclosing namespace is returned, so the caller can carry its escape inward.
function enclosing_namespace(
	identifier: ts.Node,
	namespace_literals: ReadonlyMap<ts.Node, ts.Node>,
): ts.Node | undefined {
	const { parent } = identifier
	const is_member =
		(ts.isShorthandPropertyAssignment(parent) && parent.name === identifier) ||
		(ts.isPropertyAssignment(parent) && parent.initializer === identifier)

	return is_member ? namespace_literals.get(parent.parent) : undefined
}

const namespace_escape = { is_contained, enclosing_namespace }

export { namespace_escape }
