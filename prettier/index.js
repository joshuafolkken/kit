export const config = {
	useTabs: true,
	singleQuote: true,
	trailingComma: 'all',
	printWidth: 100,
	semi: false,
	arrowParens: 'always',
	bracketSpacing: true,
	endOfLine: 'lf',
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
				svelteStrictMode: true,
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
