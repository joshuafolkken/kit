export const unicorn_rules = {
	// null よりも undefined を優先
	'unicorn/no-null': 'error',
	// reduce の過度な使用を禁止
	'unicorn/no-array-reduce': 'error',
	// abbreviation を禁止（明確な命名を強制）
	'unicorn/prevent-abbreviations': 'error',
	// より良いエラーメッセージ
	'unicorn/error-message': 'error',
	// ファイル名のケース統一
	'unicorn/filename-case': ['error', { case: 'kebabCase' }],
	// for-loopよりarray methodsを優先
	'unicorn/no-for-loop': 'error',
	// Array.from()よりスプレッド演算子を優先
	'unicorn/prefer-spread': 'error',
	// Array#{indexOf,lastIndexOf}よりArray#{findIndex,findLastIndex}を優先
	'unicorn/prefer-array-find': 'error',
	// 配列の存在チェックにArray#someを優先
	'unicorn/prefer-array-some': 'error',
	// String#matchAllを優先
	'unicorn/prefer-string-replace-all': 'error',
	// 三項演算子を優先
	'unicorn/prefer-ternary': 'error',
	// より明確なエラーを投げる
	'unicorn/custom-error-definition': 'error',
	// throw new Error()の形式を強制
	'unicorn/throw-new-error': 'error',
	// 空の配列をチェック
	'unicorn/no-empty-file': 'error',
	// 静的なみずからのみのクラスを禁止
	'unicorn/no-static-only-class': 'error',
	// this別名を禁止（arrow functionを使うべき）
	'unicorn/no-this-assignment': 'error',
	// 不要なawaitを禁止
	'unicorn/no-unnecessary-await': 'error',
	// 不要なspread演算子を禁止
	'unicorn/no-useless-spread': 'error',
	// より良い正規表現
	'unicorn/better-regex': 'error',
	// catch句でのエラー名を統一
	'unicorn/catch-error-name': ['error', { name: 'error' }],
	// switchケースでのブレークを強制
	'unicorn/prefer-switch': ['error', { minimumCases: 2 }],
	// Array.isArray()を優先
	'unicorn/no-instanceof-array': 'error',
	// 単独のifを禁止（else内）
	'unicorn/no-lonely-if': 'error',
	// 否定条件を避ける
	'unicorn/no-negated-condition': 'error',
	// new Array()を禁止
	'unicorn/no-new-array': 'error',
	// Buffer()コンストラクタを禁止
	'unicorn/no-new-buffer': 'error',
	// オブジェクトをデフォルトパラメータにしない
	'unicorn/no-object-as-default-parameter': 'error',
	// 読みにくい配列分割代入を禁止
	'unicorn/no-unreadable-array-destructuring': 'error',
	// 不要なundefinedを禁止
	'unicorn/no-useless-undefined': 'error',
	// 数値セパレータのスタイルを統一
	'unicorn/numeric-separators-style': 'error',
	// flatMapを優先
	'unicorn/prefer-array-flat-map': 'error',
	// Date.now()を優先
	'unicorn/prefer-date-now': 'error',
	// デフォルトパラメータを優先
	'unicorn/prefer-default-parameters': 'error',
	// Math.trunc()を優先
	'unicorn/prefer-math-trunc': 'error',
	// モダンなDOM APIを優先
	'unicorn/prefer-modern-dom-apis': 'error',
	// 負のインデックスを優先
	'unicorn/prefer-negative-index': 'error',
	// Number.*プロパティを優先
	'unicorn/prefer-number-properties': 'error',
	// Object.fromEntries()を優先
	'unicorn/prefer-object-from-entries': 'error',
	// プロトタイプメソッドを優先
	'unicorn/prefer-prototype-methods': 'error',
	// querySelector*を優先
	'unicorn/prefer-query-selector': 'error',
	// Reflect.apply()を優先
	'unicorn/prefer-reflect-apply': 'error',
	// Set#has()を優先
	'unicorn/prefer-set-has': 'error',
	// String#slice()を優先
	'unicorn/prefer-string-slice': 'error',
	// trimStart/trimEndを優先
	'unicorn/prefer-string-trim-start-end': 'error',
	// トップレベルawaitを優先
	'unicorn/prefer-top-level-await': 'error',
	// TypeErrorを優先
	'unicorn/prefer-type-error': 'error',
	// Array#joinにセパレータを必須化
	'unicorn/require-array-join-separator': 'error',
	// toFixed()に引数を必須化
	'unicorn/require-number-to-fixed-digits-argument': 'error',
	// 一貫性のないArray#lengthへの代入を禁止
	'unicorn/no-unreadable-iife': 'error',
	// process.exit()よりthrowを優先
	'unicorn/no-process-exit': 'error',
	// textContentを優先
	'unicorn/prefer-dom-node-text-content': 'error',
	// KeyboardEvent#keyを優先
	'unicorn/prefer-keyboard-event-key': 'error',
	// 配列のインデックスメソッドを優先
	'unicorn/prefer-array-index-of': 'error',
	// EventTarget#addEventListenerを優先
	'unicorn/prefer-add-event-listener': 'error',
	// Blob#arrayBuffer/text()を優先
	'unicorn/prefer-blob-reading-methods': 'error',
	// String#codePointAtを優先
	'unicorn/prefer-code-point': 'error',
	// Element#append/prependを優先
	'unicorn/prefer-dom-node-append': 'error',
	// Element#removeを優先
	'unicorn/prefer-dom-node-remove': 'error',
	// includes()を優先（文字列）
	'unicorn/prefer-includes': 'error',
	// .at()を優先
	'unicorn/prefer-at': 'error',
}
