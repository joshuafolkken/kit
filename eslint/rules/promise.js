export const promise_rules = {
	// Promise コンストラクタの適切な使用
	'promise/no-new-statics': 'error',
	'promise/no-return-wrap': 'error',
	'promise/param-names': 'error',
	'promise/no-nesting': 'error',

	// ループ内で 1 つずつ await すると、独立した処理まで直列になる。Sonar の S9382 と同じ指摘を
	// ローカルのゲートで先に出す。ポーリングや順序が意味を持つ処理など意図的な逐次は、
	// `// eslint-disable-next-line no-await-in-loop -- <理由>` で理由を残して抑止する。
	'no-await-in-loop': 'error',

	// `promise-function-async` を有効にしている以上、`require-await` は同時に満たせない。
	// Promise を返す契約の関数（execa モックなど）は async である必要がある一方、
	// 実際に await する対象を持たないため `require-await` が必ず発火する。
	// 逃げ道の `return Promise.resolve(x)` は unicorn/no-useless-promise-resolve-reject が、
	// 非 async 化は promise-function-async が弾き、三竦みになる。
	// Promise を返す関数が async であることは promise-function-async 側で担保されるので、
	// typescript-eslint の案内どおり require-await を無効化する。
	'require-await': 'off',
	'@typescript-eslint/require-await': 'off',
}
