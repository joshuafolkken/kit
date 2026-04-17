export const import_rules = {
	// TypeScriptコンパイラが既にチェックするため無効化
	'import/no-unresolved': 'off',
	'import-x/no-unresolved': 'off',
	// Prettier: "@ianvs/prettier-plugin-sort-imports" と競合する
	// インポートの順序を強制
	// 'import/order': [
	// 	'error',
	// 	{
	// 		groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
	// 		'newlines-between': 'always',
	// 		alphabetize: { order: 'asc', caseInsensitive: true },
	// 	},
	// ],
	// 名前付きエクスポートを優先
	'import/prefer-default-export': 'off',
	'import/no-default-export': 'error',
	// 循環依存を禁止
	'import/no-cycle': 'error',
	// 未使用のインポートを禁止
	// ESLint 10 で FileEnumerator API が削除されたため no-op だが、将来の代替実装に備えて残す
	'import/no-unused-modules': [
		'error',
		{ unusedExports: true, suppressMissingFileEnumeratorAPIWarning: true },
	],
	// CommonJSを禁止
	'import/no-commonjs': 'error',
	// AMD形式を禁止
	'import/no-amd': 'error',
	// Node.jsビルトインモジュールを禁止（必要に応じて調整）
	// 'import/no-nodejs-modules': 'error',
	// 可変エクスポートを禁止
	'import/no-mutable-exports': 'error',
	// 絶対パスのインポートを禁止
	'import/no-absolute-path': 'error',
	// webpack固有のローダー構文を禁止
	'import/no-webpack-loader-syntax': 'error',
	// 自己インポートを禁止
	'import/no-self-import': 'error',
	// 同じファイルへの複数のインポートを禁止
	'import/no-duplicates': 'error',
	// 名前空間インポートを禁止
	'import/no-namespace': 'error',
	// 名前付きデフォルトエクスポートを禁止
	'import/no-named-default': 'error',
	// 匿名デフォルトエクスポートを禁止
	'import/no-anonymous-default-export': 'error',
	// インポートの際に拡張子を必須化/禁止
	'import/extensions': [
		'error',
		{
			pattern: {
				js: 'never',
				ts: 'never',
				svelte: 'always',
				svg: 'always',
				png: 'always',
				webp: 'always',
			},
			ignorePackages: true,
		},
	],
	// 最初のインポートを強制
	'import/first': 'error',
	// エクスポートの後のインポートを禁止
	'import/exports-last': 'error',
	// インポートとそれ以外の間に改行を強制
	'import/newline-after-import': 'error',
	// グループ化されていないインポートを禁止
	'import/no-unassigned-import': ['error', { allow: ['**/*.css', '**/*.scss'] }],

	// // 循環参照チェックは重いため、ローカル開発時は off、CIでのみ実行などを検討
	// // どうしても有効にしたい場合は maxDepth を指定して制限する
	// 'import/no-cycle': 'off',

	// // 未使用モジュールチェックも非常に重い
	// 'import/no-unused-modules': 'off',
}
