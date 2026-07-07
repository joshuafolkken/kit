// 普遍的に理解される短い識別子は許可する（プロジェクト全体に適用）。
// req / res / usr / cnt のような馴染みのない略語のみを検出させる。
// e2e は Playwright の page.e2e.ts 命名規約で error2error に展開されるのを防ぐ。
// unicorn 68 で prevent-abbreviations は name-replacements にリネームされたため、
// allowList はそのまま name-replacements に渡す（オプション形状は同一）。
export const NAME_REPLACEMENTS_ALLOW_LIST = {
	Props: true,
	e: true, // event handler parameter
	e2e: true, // Playwright end-to-end spec filename convention
	el: true, // DOM element
	ctx: true, // canvas/Three.js/Svelte context
	btn: true, // button element
	idx: true, // loop index
	opts: true, // options object
	params: true, // SvelteKit +page.ts params
	args: true, // function arguments
	// unicorn 68 が既定で展開を要求するようになった慣用的な短縮名（67 では許可されていた）。
	cmd: true, // command（git_cmd / cmd_arguments など普遍的に通じる短縮）
	deps: true, // dependencies（package_with_deps_schema など）
	repository: true, // unicorn 68 は repository→repo を勧めるが、明確さを優先し完全名を維持する
}

// unicorn 68→69 のベースライン方針（Issue #610 / Problem 3）:
// `unicorn.configs.recommended` で 65→68 にかけて新たに有効化されたルール
// （prefer-url-href / consistent-class-member-order / prefer-number-coercion /
//  prefer-global-number-constants / prefer-early-return / prefer-continue /
//  no-useless-undefined / no-unsafe-string-replacement / no-declarations-before-early-exit /
//  consistent-conditional-object-spread など）は、いずれも正当なクリーンアップなので
// 既定のまま維持する（consumer 側がコードを移行する）。下記の unicorn_rules は
// あくまで kit 独自に上書きが必要なルールだけを列挙する。
// 例外: consistent-boolean-name は unicorn 68 で Svelte ファイルの lint を
// クラッシュさせたが、unicorn 69 で上流修正済み（findParameter の {#each} ガード）。
// プロジェクトの is_/has_ snake_case boolean と整合するため有効のまま維持する。
// no-top-level-assignment-in-function だけは Svelte 5 の $state 再代入で誤検知するため、
// app-kit の SvelteKit eslint preset の Svelte 用 override で .svelte / .svelte.ts に限り無効化している。
export const unicorn_rules = {
	// null よりも undefined を優先
	'unicorn/no-null': 'error',
	// reduce の過度な使用を禁止
	'unicorn/no-array-reduce': 'error',
	// abbreviation を禁止（明確な命名を強制、idiomatic な短縮名は許可）
	// unicorn 68 で prevent-abbreviations から name-replacements にリネーム
	'unicorn/name-replacements': ['error', { allowList: NAME_REPLACEMENTS_ALLOW_LIST }],
	// より良いエラーメッセージ
	'unicorn/error-message': 'error',
	// ファイル名のケース統一（unicorn 65 で既定 true になった checkDirectories を無効化し、
	// ディレクトリ名は検査しない。ディレクトリ構造は SvelteKit とプロジェクト規約が決める）
	'unicorn/filename-case': ['error', { case: 'kebabCase', checkDirectories: false }],
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
	// catch句でのエラー名を統一
	'unicorn/catch-error-name': ['error', { name: 'error' }],
	// switchケースでのブレークを強制
	'unicorn/prefer-switch': ['error', { minimumCases: 2 }],
	// instanceof による組み込みオブジェクト判定を禁止（Array.isArray() などを優先）。
	// unicorn 68 で no-instanceof-array から no-instanceof-builtins にリネーム（対象が拡大）
	'unicorn/no-instanceof-builtins': 'error',
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
	// 16進リテラルを lowercase に統一（prettier の hex 正規化と整合させ
	// eslint↔prettier の無限 fix ループを防ぐ）
	'unicorn/number-literal-case': ['error', { hexadecimalValue: 'lowercase' }],
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
