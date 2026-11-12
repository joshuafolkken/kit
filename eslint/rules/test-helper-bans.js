// テストが共有ヘルパーを素通りする 2 つの書き方を lint で止めるルール群（Issue #6489）。
// 詳細は prompts/testing-guide.md の「Use the shared test helpers」。
//
// kit 自身の `eslint.config.js` だけが wire する。代替の `temporary_directory` は `tools/test/` にあり
// パッケージに含まれないので、base config に入れると consumer は直しようのない違反を抱える。

const TEST_HELPER_BAN_PATTERNS = ['**/*.test.ts']

// `mkdtempSync(...)` と `fs.mkdtempSync(...)` の呼び出しだけに一致する。`vi.mock('node:fs')` の
// ファクトリにある `mkdtempSync: vi.fn()` はプロパティなので一致しない。
const MKDTEMP_SYNC_ENTRY = {
	selector:
		"CallExpression:matches([callee.name='mkdtempSync'], [callee.property.name='mkdtempSync'])",
	message:
		'Use temporary_directory() from #tools/test/temporary-directory instead of calling mkdtempSync in a test: it registers the cleanup. See prompts/testing-guide.md.',
}

// vitest の設定が `clearMocks: true` なので、`beforeEach` での呼び出しは毎テスト前の自動クリアの重複。
// テストの途中で呼ぶ形は自動クリアでは代替できないため対象外にする。
const CLEAR_ALL_MOCKS_IN_BEFORE_EACH_ENTRY = {
	selector:
		"CallExpression[callee.name='beforeEach'] CallExpression[callee.object.name='vi'][callee.property.name='clearAllMocks']",
	message:
		'Remove vi.clearAllMocks() from beforeEach: the vitest config sets clearMocks: true, so every test already starts with cleared mocks. See prompts/testing-guide.md.',
}

const TEST_HELPER_BAN_ENTRIES = [MKDTEMP_SYNC_ENTRY, CLEAR_ALL_MOCKS_IN_BEFORE_EACH_ENTRY]

export {
	TEST_HELPER_BAN_PATTERNS,
	MKDTEMP_SYNC_ENTRY,
	CLEAR_ALL_MOCKS_IN_BEFORE_EACH_ENTRY,
	TEST_HELPER_BAN_ENTRIES,
}
