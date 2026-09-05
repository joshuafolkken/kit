// テストファイル名の規約を lint ゲートで強制するルール群（Issue #593）。
// kit はユニット/統合テストを `*.test.ts`、コンポーネント/ブラウザテストを
// `*.svelte.test.ts` と定め、`*.spec.ts` を禁止している。ドキュメントだけの規約は
// 二度ドリフトを許した（consumer が `*.spec.ts` + 集中 `tests/` に流れた）ため、
// vitest matcher を絞る（= 黙って未実行になる）のではなく、声高に失敗する lint
// ルールでガードする。詳細は prompts/testing-guide.md の「Test file naming & placement」。

const SPEC_FILENAME_MESSAGE =
	'Rename this file: the *.spec.* suffix is forbidden, in every JS/TS extension. Use *.test.ts (node/unit) or *.svelte.test.ts (component/browser). See prompts/testing-guide.md.'

const CENTRALIZED_TESTS_DIRECTORY_MESSAGE =
	'A top-level tests/ directory is forbidden. Colocate every test next to the code it exercises (foo.test.ts beside foo.ts), and place E2E specs under src/routes/**. See prompts/testing-guide.md.'

// joshuafolkken/kit#1414: 禁止の対象拡張子。`.ts` / `.js` だけを見ていたため
// `tests/foo.tsx`、`tests/foo.mts`、`Foo.spec.tsx` がどちらの禁止も素通りしていた。
// 「トップレベル `tests/` ディレクトリそのものを禁止する」というドキュメントの主張に
// allowlist が届いていない状態だったので、この生態系に実在する JS/TS の拡張子を全て挙げる。
//
// `.svelte` は意図的に含めない。base config には svelte パーサが無く、`tests/Foo.svelte` を
// この glob に入れるとパースエラーになる — lint は落ちるが、rename/move を指示する
// このルールのメッセージではなく、パーサの苦情が出る。`Foo.svelte.spec.ts` の形は
// `*.spec.ts` 側で既に捕まるため、抜けているのは `tests/` 直下の `.svelte` だけである。
const BANNED_EXTENSIONS = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}'

// `*.spec.*` を禁止する glob。`Foo.svelte.spec.ts` も `*.spec.ts` に一致する。
const SPEC_FILENAME_PATTERNS = [`**/*.spec.${BANNED_EXTENSIONS}`]

// ドリフトのもう半分: トップレベル `tests/` ディレクトリの禁止。テストは対象モジュールの
// 隣に colocate する規約なので、集中ディレクトリ配置を flag する。
const CENTRALIZED_TESTS_DIRECTORY_PATTERNS = [`tests/**/*.${BANNED_EXTENSIONS}`]

const RESTRICTED_SYNTAX_RULE = 'no-restricted-syntax'

// `Program` セレクタはファイルのルートノードに一度だけ一致するため、対象ファイルごとに
// 確実に 1 件だけ報告する。どちらを適用するかは files glob 側で限定する。
const SPEC_FILENAME_ENTRY = { selector: 'Program', message: SPEC_FILENAME_MESSAGE }

const CENTRALIZED_TESTS_DIRECTORY_ENTRY = {
	selector: 'Program',
	message: CENTRALIZED_TESTS_DIRECTORY_MESSAGE,
}

// joshuafolkken/kit#1414: この 2 つは禁止だけを載せた既製レコードで、
// `@joshuafolkken/kit/eslint/test-filename` から単独で import する consumer 向けに残している。
// **そのまま wire すると、flat config は `no-restricted-syntax` をマージせず置き換えるので、
// consumer 自身が設定していたセレクタが禁止パターンのファイルで全て消える。** 既存の制限を
// 残したい場合は下の `extend_restricted_syntax` にレコードを渡して合成すること。
// kit の base config と `eslint.config.js` はどちらもそちらを使っている。
// ここで kit 側のセレクタを畳み込まないのは、単独 import した consumer が求めていない
// ルールを押し付けることになるからである。

/** @type {import('eslint').Linter.RulesRecord} */
const spec_filename_rules = {
	[RESTRICTED_SYNTAX_RULE]: ['error', SPEC_FILENAME_ENTRY],
}

/** @type {import('eslint').Linter.RulesRecord} */
const centralized_tests_directory_rules = {
	[RESTRICTED_SYNTAX_RULE]: ['error', CENTRALIZED_TESTS_DIRECTORY_ENTRY],
}

// joshuafolkken/kit#1414: flat config はルールをマージせず置き換えるので、禁止ブロックが
// `no-restricted-syntax` を単独で設定すると、共有ルール側が同じキーで持つセレクタが
// 禁止パターンに一致するファイルでは全て黙って消える。既存のエントリの上に重ねることで、
// 禁止ファイルでも共有セレクタが効いたままになる — セレクタを書き写さないので単一ソース。
//
// **severity は常に `error` で、`base_rules` 側の severity は引き継がない。** 禁止は声高に
// 失敗することが存在理由なので、`['warn', ...]` の設定に合わせて禁止まで warn に落ちるのは
// 誤りである。代償として、warn や off で置いてあったセレクタは禁止パターンのファイルでだけ
// error に上がる — 対象はどのみち rename/move しか正解の無いファイルなので許容する。
/**
 * @param {import('eslint').Linter.RulesRecord} base_rules
 * @param {{ selector: string; message: string }} ban_entry
 * @returns {import('eslint').Linter.RulesRecord}
 */
function extend_restricted_syntax(base_rules, ban_entry) {
	const configured = base_rules[RESTRICTED_SYNTAX_RULE]
	const base_entries = Array.isArray(configured) ? configured.slice(1) : []

	return { [RESTRICTED_SYNTAX_RULE]: ['error', ...base_entries, ban_entry] }
}

export {
	SPEC_FILENAME_PATTERNS,
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	SPEC_FILENAME_ENTRY,
	CENTRALIZED_TESTS_DIRECTORY_ENTRY,
	spec_filename_rules,
	centralized_tests_directory_rules,
	extend_restricted_syntax,
}
