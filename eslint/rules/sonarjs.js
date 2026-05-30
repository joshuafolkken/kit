export const sonarjs_rules = {
	// 認知的複雑度の制限（より厳しい複雑度の指標）
	'sonarjs/cognitive-complexity': ['error', 4],
	// 同一の条件分岐を禁止
	'sonarjs/no-identical-conditions': 'error',
	// 同一の関数を禁止
	'sonarjs/no-identical-functions': 'error',
	// 重複した文字列リテラルを禁止
	'sonarjs/no-duplicate-string': ['error', { threshold: 2 }],
	// ネストされた制御フロー文を制限
	'sonarjs/max-switch-cases': ['error', 3],
	// コレクションのサイズを常にチェック
	'sonarjs/no-collection-size-mischeck': 'error',
	// 無駄なジャンプ文を禁止
	'sonarjs/no-redundant-jump': 'error',
	// 同じ条件の連続したif文を禁止
	'sonarjs/no-same-line-conditional': 'error',
	// 使われない関数パラメータを禁止
	'sonarjs/no-unused-collection': 'error',
	// すべてが同じ値を返すswitch文を禁止
	'sonarjs/no-all-duplicated-branches': 'error',
	// 無駄な条件を禁止
	'sonarjs/no-redundant-boolean': 'error',
	// Promiseコールバック内でのreturnを必須化
	'promise/always-return': 'error',
	// catch()ハンドラを必須化
	'promise/catch-or-return': 'error',
	// Promiseのexecutor関数内でのreturnを禁止
	'promise/no-return-in-finally': 'error',
	// Promise.all()の引数が配列でない場合を禁止
	'promise/valid-params': 'error',
	// Promiseチェーン内での一貫性を強制
	'promise/prefer-await-to-then': 'error',
	// Promiseチェーン内での一貫性を強制
	'promise/prefer-await-to-callbacks': 'error',
	// ブール値を返すだけの無駄な条件を禁止
	'sonarjs/prefer-immediate-return': 'error',
	// 無駄なジャンプ文を禁止
	'sonarjs/prefer-single-boolean-return': 'error',

	// // 非常に重いため無効化。非推奨チェックは @typescript-eslint/no-deprecated で十分
	// 'sonarjs/deprecation': 'off',
	// // AWS関連のルールは不要な場合が多い
	// 'sonarjs/aws-restricted-ip-admin-access': 'off',
}
