import { config as static_config } from './static.js'

export const config = {
	...static_config,
	plugins: [
		'@ianvs/prettier-plugin-sort-imports',
		'prettier-plugin-svelte',
		'prettier-plugin-tailwindcss',
	],
	overrides: [
		{
			files: '*.svelte',
			options: {
				parser: 'svelte',
				svelteIndentScriptAndStyle: true,
				svelteSortOrder: 'options-scripts-markup-styles',
			},
		},
		{
			files: '*.jsonc',
			options: {
				trailingComma: 'none',
			},
		},
	],
}
