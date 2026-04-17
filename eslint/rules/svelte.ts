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
