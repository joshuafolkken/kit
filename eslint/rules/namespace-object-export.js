// namespace-object-export: 複数の関数を個別に export しているファイルを error にするルール
// （joshuafolkken/kit#2180）。kit の規約は「複数の関数は名前空間オブジェクト（`export { my_module }`）
// にまとめる。定数は対象外」で、これは §4.2 のチェックリスト7項目のうち唯一 lint ルールが無く、
// 目視でしか判定できなかった項目だった。散文の指示に頼るとドリフトするため、声高に失敗する lint
// ルールでガードする。詳細は CLAUDE.md の Critical Conventions → Functions & exports。
//
// 検出対象は「インラインで export された関数定義」に限る。`export function foo` と
// `export const foo = () => {}` / `export const foo = function () {}` を数え、2 件以上あれば違反。
// `export { my_module }`（名前空間オブジェクト）は declaration を持たないため数に入らず、単一の
// export 関数も許容される。`declare function`（TSDeclareFunction）は型宣言なので対象外。
//
// SvelteKit のルートハンドラ（GET/POST/... や load/actions/fallback）は CLAUDE.md が明示的に
// 個別 export を許可しているため除外する。

const RULE_MESSAGE =
	'Group these exported functions into a single namespace object (`export { my_module }`). Individual function exports are only allowed when a file exports exactly one. See CLAUDE.md → Functions & exports.'

// 2 件以上で違反。1 件の個別 export は許容される。
const MIN_INDIVIDUAL_EXPORTS = 2

// CLAUDE.md が個別 export を許可する SvelteKit ルートハンドラ名。これらは数に入れない。
const ROUTE_HANDLER_NAMES = new Set([
	'GET',
	'POST',
	'PUT',
	'DELETE',
	'PATCH',
	'OPTIONS',
	'HEAD',
	'load',
	'actions',
	'fallback',
])

const ARROW_FUNCTION = 'ArrowFunctionExpression'
const FUNCTION_EXPRESSION = 'FunctionExpression'
const FUNCTION_DECLARATION = 'FunctionDeclaration'
const VARIABLE_DECLARATION = 'VariableDeclaration'
const IDENTIFIER = 'Identifier'

function is_function_expression(node) {
	return node?.type === ARROW_FUNCTION || node?.type === FUNCTION_EXPRESSION
}

// 単一の declarator が名前つき関数式なら、その名前。それ以外は undefined。
function declarator_function_name(declarator) {
	const is_named = is_function_expression(declarator.init) && declarator.id.type === IDENTIFIER

	return is_named ? declarator.id.name : undefined
}

// `export const foo = () => {}` / `= function () {}` の関数名。定数（オブジェクト・プリミティブ）は
// undefined を返して数から外す。
function variable_function_name(declaration) {
	const [declarator] = declaration.declarations

	return declarator ? declarator_function_name(declarator) : undefined
}

// declaration ノードの種類から関数名を取り出す。関数でなければ undefined。
function declaration_function_name(declaration) {
	if (declaration.type === FUNCTION_DECLARATION) return declaration.id.name

	return declaration.type === VARIABLE_DECLARATION ? variable_function_name(declaration) : undefined
}

// インライン export された関数の名前、関数でなければ undefined。
function exported_function_name(node) {
	const { declaration } = node

	return declaration ? declaration_function_name(declaration) : undefined
}

function is_counted_export(node) {
	const name = exported_function_name(node)

	return name !== undefined && !ROUTE_HANDLER_NAMES.has(name)
}

function create(context) {
	const individual_exports = []

	return {
		ExportNamedDeclaration(node) {
			if (is_counted_export(node)) individual_exports.push(node)
		},
		'Program:exit'() {
			if (individual_exports.length < MIN_INDIVIDUAL_EXPORTS) return

			for (const node of individual_exports) context.report({ node, message: RULE_MESSAGE })
		},
	}
}

/** @type {import('eslint').Rule.RuleModule} */
const namespace_object_export_rule = {
	meta: {
		type: 'suggestion',
		docs: {
			description: 'Require multiple exported functions to be grouped into a namespace object',
		},
		schema: [],
	},
	create,
}

export { RULE_MESSAGE, namespace_object_export_rule }
