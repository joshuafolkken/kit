export const code_quality_rules = {
	// ===== 一般的なコード品質 =====
	// console の使用を警告（開発時は許可、本番ではエラーにするべき）
	'no-console': ['error'],
	// 'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
	// デバッガーの使用を禁止
	'no-debugger': 'error',
	// var の使用を禁止
	'no-var': 'error',
	// const を優先
	'prefer-const': 'error',
	// アロー関数を優先
	'prefer-arrow-callback': 'error',
	// テンプレートリテラルを優先
	'prefer-template': 'error',
	// 等価演算子は厳密等価を使用
	eqeqeq: ['error', 'always'],
	// 不要な return を禁止
	'no-useless-return': 'error',
	// 不要な catch を禁止
	'no-useless-catch': 'error',
	// 複雑度の制限
	complexity: ['error', 5],
	// 最大ネストレベル
	'max-depth': ['error', 2],
	// 関数の最大行数
	'max-lines-per-function': ['error', { max: 25, skipBlankLines: true, skipComments: true }],
	// ファイルの最大行数
	'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
	// パラメータの最大数
	'max-params': ['error', 4],
	// 関数内の文の数を制限
	'max-statements': ['error', 10],
	// 1行の最大長
	'max-len': [
		'error',
		{
			code: 100,
			tabWidth: 2,
			ignoreUrls: true,
			ignoreStrings: true,
			ignoreTemplateLiterals: true,
			ignoreRegExpLiterals: true,
			ignoreComments: true,
			ignorePattern: String.raw`^\s*class(:|=)|d="`,
		},
	],
	// 一貫した return
	'consistent-return': 'error',
	// 不要な else を禁止
	'no-else-return': 'error',
	// 重複したインポートを禁止
	'no-duplicate-imports': 'error',
	// 変数名の最小・最大長を制限
	'id-length': [
		'error',
		{
			min: 2,
			max: 30,
			exceptions: ['_', 'i', 'j', 'k', 'x', 'y', 'z'],
			properties: 'never',
		},
	],
	// 空のブロック文を禁止
	'no-empty': ['error', { allowEmptyCatch: false }],
	// ループ内で関数を作成することを禁止
	'no-loop-func': 'error',
	// 同じ変数への複数回の代入を制限
	'no-multi-assign': 'error',
	// 複数の空行を禁止
	'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 0, maxBOF: 0 }],
	// ネストされた三項演算子を禁止
	'no-nested-ternary': 'error',
	// new演算子を単独で使用することを禁止
	'no-new': 'error',
	// 配列コンストラクタを禁止
	'no-array-constructor': 'error',
	// Objectコンストラクタを禁止
	'no-object-constructor': 'error',
	// 不要な計算プロパティキーを禁止
	'no-useless-computed-key': 'error',
	// 不要なコンストラクタを禁止
	'no-useless-constructor': 'off', // TypeScript版を使用
	'@typescript-eslint/no-useless-constructor': 'error',
	// 不要な連結を禁止
	'no-useless-concat': 'error',
	// 不要なエスケープを禁止
	'no-useless-escape': 'error',
	// void演算子を禁止
	'no-void': ['error', { allowAsStatement: true }],
	// ラベル付き文を禁止
	'no-labels': 'error',
	// 単独のifをelse内に置くことを禁止
	'no-lonely-if': 'error',
	// 短絡評価を優先
	'no-unneeded-ternary': 'error',
	// オブジェクトのショートハンドを優先
	'object-shorthand': ['error', 'always'],
	// 分割代入を優先
	'prefer-destructuring': [
		'error',
		{
			VariableDeclarator: {
				array: true,
				object: true,
			},
			AssignmentExpression: {
				array: false,
				object: false,
			},
		},
		{
			enforceForRenamedProperties: false,
		},
	],
	// 指数演算子を優先
	'prefer-exponentiation-operator': 'error',
	// 数値リテラルを優先
	'prefer-numeric-literals': 'error',
	// Object.hasOwnを優先
	'prefer-object-has-own': 'error',
	// オブジェクトスプレッドを優先
	'prefer-object-spread': 'error',
	// restパラメータを優先
	'prefer-rest-params': 'error',
	// スプレッド演算子を優先
	'prefer-spread': 'error',
	// 正規表現リテラルを優先
	'prefer-regex-literals': 'error',
	// Promiseのrejectには必ずErrorオブジェクトを渡す
	'prefer-promise-reject-errors': 'error',
	// 基数パラメータを必須に
	radix: 'error',
	// await式を要求
	'require-atomic-updates': 'error',
	// Unicode正規表現フラグを要求
	'require-unicode-regexp': 'error',
	// Symbolの説明を必須に
	'symbol-description': 'error',
	// Yodaスタイルを禁止
	yoda: 'error',
	// パラメータの再代入を禁止
	'no-param-reassign': 'error',
	// 暗黙的な型変換を禁止
	'no-implicit-coercion': 'error',
	// カンマ演算子を禁止
	'no-sequences': 'error',
	// ビット演算子を禁止
	'no-bitwise': 'error',
	// continue文を禁止
	'no-continue': 'error',
	// インクリメント・デクリメント演算子を禁止
	'no-plusplus': ['error', { allowForLoopAfterthoughts: true }],
	// arguments.caller/calleeを禁止
	'no-caller': 'error',
	// evalを禁止
	'no-eval': 'error',
	// 暗黙的なevalを禁止
	'no-implied-eval': 'error',
	// with文を禁止
	'no-with': 'error',
	// __iterator__を禁止
	'no-iterator': 'error',
	// __proto__を禁止
	'no-proto': 'error',
	// スクリプトURLを禁止
	'no-script-url': 'error',
	// カンマ演算子を禁止（ループを除く）
	'no-restricted-syntax': [
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
			selector: 'ExportNamedDeclaration > FunctionDeclaration:not([id.name=/^use_/])',
			message:
				'Individual named exports (functions) are not allowed. Use object export instead. Example: export const module_name = { function_name }',
		},
		{
			selector:
				'ExportNamedDeclaration > VariableDeclaration[declarations.length=1] > VariableDeclarator[id.type="Identifier"]:not([id.name=/^[A-Z_]+$/]):not([init.type="ObjectExpression"]):not([init.type="ArrayExpression"]):not([init.type="ArrowFunctionExpression"])',
			message:
				'Individual named exports (constants) are not allowed (except UPPER_CASE). Use object export instead. Example: export const module_name = { constant_name }',
		},
	],
	// delete演算子を変数に使用することを禁止
	'no-delete-var': 'error',
	// undefinedへの代入を禁止
	// 'no-undefined': 'error',
	// 初期化されていない変数を禁止
	'init-declarations': ['error', 'always'],
	// シャドーイングを禁止
	'no-shadow': 'off', // TypeScript版を使用
	'@typescript-eslint/no-shadow': 'error',
	// グローバル変数のシャドーイングを禁止
	'no-shadow-restricted-names': 'error',
	// alert/confirm/promptを禁止
	'no-alert': 'error',
	// 拡張されたネイティブオブジェクトを禁止
	'no-extend-native': 'error',
	// 不要なbind()を禁止
	'no-extra-bind': 'error',
	// 不要なラベルを禁止
	'no-extra-label': 'error',
	// caseのフォールスルーを禁止
	'no-fallthrough': 'error',
	// 浮動小数点の省略を禁止
	'no-floating-decimal': 'error',
	// グローバル変数への代入を禁止
	'no-global-assign': 'error',
	// 型変換の短縮形を禁止
	'no-implicit-globals': 'error',
	// ループ内で変更されない条件を禁止
	'no-unmodified-loop-condition': 'error',
	// 不要な.call()/.apply()を禁止
	'no-useless-call': 'error',
	// カーリーブレースを必須化
	curly: ['error', 'multi-line'],
	// default caseを要求
	'default-case': 'error',
	// default caseを最後に配置
	'default-case-last': 'error',
	// ドット記法を優先
	'dot-notation': [
		'error',
		{
			allowPattern: String.raw`^[A-Z0-9_]+$`,
		},
	],
	// 分割代入のデフォルト値を要求
	'default-param-last': 'error',
	// グループ化された変数宣言を要求
	'one-var': ['error', 'never'],
	// 変数を使用する前に宣言を要求
	'no-use-before-define': 'off', // TypeScript版を使用
	'@typescript-eslint/no-use-before-define': 'error',
	// throw文でErrorオブジェクトを要求
	'no-throw-literal': 'off', // TypeScript版を使用
	'@typescript-eslint/only-throw-error': 'error',
	// 文字列リテラルでのオクタル・エスケープシーケンスを禁止
	'no-octal-escape': 'error',
	// 8進数リテラルを禁止
	'no-octal': 'error',
	// 関数のパラメータ名の重複を禁止
	'no-dupe-args': 'error',
	// オブジェクトのキーの重複を禁止
	'no-dupe-keys': 'error',
	// case句の重複を禁止
	'no-duplicate-case': 'error',
	// 正規表現での空の文字クラスを禁止
	'no-empty-character-class': 'error',
	// 条件式での代入を禁止
	'no-cond-assign': 'error',
	// 定数条件を禁止
	'no-constant-condition': 'error',
	// 制御文字を禁止
	'no-control-regex': 'error',
	// 未定義変数の使用を禁止（TypeScriptで管理）
	// 'no-undef': 'error', // 既にoffに設定済み
	// 正規表現での複数のスペースを禁止
	'no-regex-spaces': 'error',
	// スパースアレイを禁止
	'no-sparse-arrays': 'error',

	// アノテーションコメントを禁止（issueに登録すべき）
	'no-warning-comments': [
		'error',
		{
			terms: ['todo', 'fixme', 'hack'],
			location: 'anywhere',
		},
	],

	// async 関数は必ず await を含む
	'require-await': 'error',
}
