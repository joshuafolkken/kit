const ROUTE_HANDLER_NAMES = '/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|load|actions|fallback)$/u'

const ROUTE_HANDLER_ARROW_SELECTOR = `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name=${ROUTE_HANDLER_NAMES}][init.type="ArrowFunctionExpression"]`

export const ROUTE_NO_RESTRICTED_SYNTAX = [
	'error',
	{
		selector: 'ForInStatement',
		message:
			'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
	},
	{
		selector: 'LabeledStatement',
		message:
			'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
	},
	{
		selector: 'WithStatement',
		message:
			'`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
	},
	{
		selector: ROUTE_HANDLER_ARROW_SELECTOR,
		message:
			'SvelteKit route handlers must use function syntax: `export function GET(event) {}` not `export const GET = () => {}`.',
	},
] as const

export const svelte_rules = {
	// a11y（アクセシビリティ）ルールを厳格に
	'svelte/valid-compile': 'error',
	'svelte/no-at-html-tags': 'error',
	'svelte/no-dom-manipulating': 'error',
	'svelte/require-optimized-style-attribute': 'error',

	// ナビゲーションのパス解決を必須にしない
	'svelte/no-navigation-without-resolve': [
		'error',
		{
			ignoreLinks: true,
		},
	],
}
