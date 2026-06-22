// テストファイル名の規約を lint ゲートで強制するルール群（Issue #593）。
// kit はユニット/統合テストを `*.test.ts`、コンポーネント/ブラウザテストを
// `*.svelte.test.ts` と定め、`*.spec.ts` を禁止している。ドキュメントだけの規約は
// 二度ドリフトを許した（consumer が `*.spec.ts` + 集中 `tests/` に流れた）ため、
// vitest matcher を絞る（= 黙って未実行になる）のではなく、声高に失敗する lint
// ルールでガードする。詳細は prompts/testing-guide.md の「Test file naming & placement」。

const SPEC_FILENAME_MESSAGE =
	'Rename this file: the *.spec.ts / *.spec.js suffix is forbidden. Use *.test.ts (node/unit) or *.svelte.test.ts (component/browser). See prompts/testing-guide.md.'

const CENTRALIZED_TESTS_DIRECTORY_MESSAGE =
	'A top-level tests/ directory is forbidden. Colocate every test next to the code it exercises (foo.test.ts beside foo.ts), and place E2E specs under src/routes/**. See prompts/testing-guide.md.'

// `*.spec.ts` / `*.spec.js` を禁止する glob。`Foo.svelte.spec.ts` も `*.spec.ts` に一致する。
const SPEC_FILENAME_PATTERNS = ['**/*.spec.ts', '**/*.spec.js']

// ドリフトのもう半分: トップレベル `tests/` ディレクトリの禁止。テストは対象モジュールの
// 隣に colocate する規約なので、集中ディレクトリ配置を flag する。
const CENTRALIZED_TESTS_DIRECTORY_PATTERNS = ['tests/**/*.ts', 'tests/**/*.js']

// `Program` セレクタはファイルのルートノードに一度だけ一致するため、対象ファイルごとに
// 確実に 1 件だけ報告する。どちらを適用するかは files glob 側で限定する。
/** @type {import('eslint').Linter.RulesRecord} */
const spec_filename_rules = {
	'no-restricted-syntax': ['error', { selector: 'Program', message: SPEC_FILENAME_MESSAGE }],
}

/** @type {import('eslint').Linter.RulesRecord} */
const centralized_tests_directory_rules = {
	'no-restricted-syntax': [
		'error',
		{ selector: 'Program', message: CENTRALIZED_TESTS_DIRECTORY_MESSAGE },
	],
}

export {
	SPEC_FILENAME_PATTERNS,
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	spec_filename_rules,
	centralized_tests_directory_rules,
}
