export const typescript_rules = {
	// ===== TypeScript 厳格化 =====
	// 明示的な関数戻り値の型を必須に
	'@typescript-eslint/explicit-function-return-type': [
		'error',
		{
			allowExpressions: true,
			allowTypedFunctionExpressions: true,
			allowHigherOrderFunctions: true,
			allowDirectConstAssertionInArrowFunctions: true,
			allowConciseArrowFunctionExpressionsStartingWithVoid: false,
		},
	],
	// モジュールの境界で明示的な型を必須に
	'@typescript-eslint/explicit-module-boundary-types': 'error',
	// any の使用を禁止
	'@typescript-eslint/no-explicit-any': 'error',
	// 未使用変数を禁止
	'@typescript-eslint/no-unused-vars': [
		'error',
		{
			argsIgnorePattern: '^_',
			varsIgnorePattern: '^_',
			caughtErrorsIgnorePattern: '^_',
		},
	],
	// 不要な型アサーションを禁止
	'@typescript-eslint/no-unnecessary-type-assertion': 'error',
	// 不要な条件を禁止
	'@typescript-eslint/no-unnecessary-condition': 'error',
	// 浮動Promiseを禁止
	'@typescript-eslint/no-floating-promises': 'error',
	// 誤ったPromiseの使い方を禁止
	'@typescript-eslint/no-misused-promises': 'error',
	// switch文のフォールスルーを禁止
	'@typescript-eslint/switch-exhaustiveness-check': 'error',
	// 厳格なboolean式
	// '@typescript-eslint/strict-boolean-expressions': [
	// 	'error',
	// 	{
	// 		allowString: false,
	// 		allowNumber: false,
	// 		allowNullableObject: true,
	// 		allowNullableBoolean: true,
	// 		allowNullableString: true,
	// 		allowNullableNumber: true,
	// 		allowAny: true,
	// 	},
	// ],
	// nullishオペレーターの適切な使用
	'@typescript-eslint/prefer-nullish-coalescing': 'error',
	// optional chainingの適切な使用
	'@typescript-eslint/prefer-optional-chain': 'error',
	// 配列のメソッドチェーンを推奨
	'@typescript-eslint/prefer-reduce-type-parameter': 'error',
	// return await を推奨
	'@typescript-eslint/return-await': ['error', 'always'],
	// 配列のインデックスアクセス時の型安全性
	'@typescript-eslint/no-unsafe-member-access': 'error',
	'@typescript-eslint/no-unsafe-call': 'error',
	'@typescript-eslint/no-unsafe-return': 'error',
	'@typescript-eslint/no-unsafe-assignment': 'error',
	// 型のインポートを明示
	'@typescript-eslint/consistent-type-imports': [
		'error',
		{
			prefer: 'type-imports',
			fixStyle: 'inline-type-imports',
		},
	],
	// 型定義のエクスポート方法を統一
	'@typescript-eslint/consistent-type-exports': [
		'error',
		{
			fixMixedExportsWithInlineTypeSpecifier: true,
		},
	],
	// 配列型の表記を統一（T[] ではなく Array<T> を推奨）
	'@typescript-eslint/array-type': ['error', { default: 'generic' }],
	// メソッドシグネチャよりプロパティシグネチャを優先
	'@typescript-eslint/method-signature-style': ['error', 'property'],
	// 型アサーションよりas constを優先
	'@typescript-eslint/prefer-as-const': 'error',
	// enum宣言よりas constオブジェクトを優先
	'@typescript-eslint/prefer-enum-initializers': 'error',
	// for-of を優先
	'@typescript-eslint/prefer-for-of': 'error',
	// 関数型の表記を統一
	'@typescript-eslint/prefer-function-type': 'error',
	// includes()を優先
	'@typescript-eslint/prefer-includes': 'error',
	// string literalよりtemplate literalを優先
	'@typescript-eslint/prefer-literal-enum-member': 'error',
	// namespace よりES6モジュールを優先
	'@typescript-eslint/prefer-namespace-keyword': 'error',
	// RegExp#exec() よりString#match()を優先
	'@typescript-eslint/prefer-regexp-exec': 'error',
	// String#startsWith()を優先
	'@typescript-eslint/prefer-string-starts-ends-with': 'error',
	// void演算子の使用を制限
	'@typescript-eslint/no-meaningless-void-operator': 'error',
	// 重複した型ユニオン/インターセクションメンバーを禁止
	'@typescript-eslint/no-duplicate-type-constituents': 'error',
	// 無駄な型パラメータを禁止
	'@typescript-eslint/no-unnecessary-type-parameters': 'error',
	// Promise返す関数には非同期処理を必須に
	'@typescript-eslint/promise-function-async': 'error',
	// 混乱を招くvoid式を禁止
	'@typescript-eslint/no-confusing-void-expression': 'error',
	// 動的なdelete演算子を禁止
	'@typescript-eslint/no-dynamic-delete': 'error',
	// 無効なvoid型を禁止
	'@typescript-eslint/no-invalid-void-type': 'error',
	// 非nullアサーションの後の代替を禁止
	'@typescript-eslint/no-non-null-asserted-nullish-coalescing': 'error',
	// requireを禁止（ES6 importを使用）
	'@typescript-eslint/no-require-imports': 'error',
	// 型アサーションを制限
	'@typescript-eslint/consistent-type-assertions': [
		'error',
		{
			assertionStyle: 'as',
			objectLiteralTypeAssertions: 'never',
		},
	],
	// デフォルトエクスポートを禁止（既存のimport/no-default-exportと併用）
	'@typescript-eslint/no-restricted-imports': [
		'error',
		{
			patterns: [
				{
					group: ['../*'],
					message: 'Relative imports from parent directories can make refactoring difficult.',
				},
			],
		},
	],
	// 型のみのインポートを分離
	'@typescript-eslint/no-import-type-side-effects': 'error',
	// inferを適切に使用
	'@typescript-eslint/no-unnecessary-qualifier': 'error',
	// 不要なtemplate expressionを禁止
	'@typescript-eslint/no-base-to-string': 'error',
	// 配列のソートにcompare関数を必須化
	'@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
	// +演算子での文字列連結を制限
	'@typescript-eslint/restrict-plus-operands': [
		'error',
		{
			allowAny: false,
			allowBoolean: false,
			allowNullish: false,
			allowNumberAndString: false,
			allowRegExp: false,
		},
	],
	// テンプレート内の型を制限
	'@typescript-eslint/restrict-template-expressions': [
		'error',
		{
			allowAny: false,
			allowBoolean: false,
			allowNullish: false,
			allowNumber: false,
			allowRegExp: false,
		},
	],

	// マジックナンバーを禁止
	'@typescript-eslint/no-magic-numbers': [
		'error',
		{
			ignoreArrayIndexes: false,
			ignoreDefaultValues: false,
			enforceConst: true,
			detectObjects: false,
			ignore: [0, 1, -1],
			ignoreEnums: true,
			ignoreNumericLiteralTypes: true,
			ignoreReadonlyClassProperties: true,
		},
	],

	// async 関数は必ず await を含む
	'@typescript-eslint/require-await': 'error',
}
