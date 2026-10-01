import { config as basic_config } from './basic.js'

export const config = {
	...basic_config,
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
