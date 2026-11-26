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

	// joshuafolkken/kit#8886: every deprecated use it reports, `@typescript-eslint/no-deprecated` reports
	// at the same place, for a fraction of its cost. Its one extra report is the import line of a
	// deprecated name, whose use is reported anyway. `base.js` turns the typescript-eslint rule back on
	// in tests, where this rule was the only one checking.
	'sonarjs/deprecation': 'off',
	// joshuafolkken/kit#8886: these check AWS CDK, React, Vue and Angular code. kit and the projects it
	// configures are SvelteKit and Node TypeScript and import none of them, so the rules ran on every
	// file and could never report.
	'sonarjs/aws-apigateway-public-api': 'off',
	'sonarjs/aws-ec2-rds-dms-public': 'off',
	'sonarjs/aws-ec2-unencrypted-ebs-volume': 'off',
	'sonarjs/aws-efs-unencrypted': 'off',
	'sonarjs/aws-iam-all-privileges': 'off',
	'sonarjs/aws-iam-privilege-escalation': 'off',
	'sonarjs/aws-iam-public-access': 'off',
	'sonarjs/aws-opensearchservice-domain': 'off',
	'sonarjs/aws-rds-unencrypted-databases': 'off',
	'sonarjs/aws-restricted-ip-admin-access': 'off',
	'sonarjs/aws-s3-bucket-granted-access': 'off',
	'sonarjs/aws-s3-bucket-insecure-http': 'off',
	'sonarjs/aws-s3-bucket-public-access': 'off',
	'sonarjs/aws-s3-bucket-versioning': 'off',
	'sonarjs/aws-sagemaker-unencrypted-notebook': 'off',
	'sonarjs/aws-sns-unencrypted-topics': 'off',
	'sonarjs/aws-sqs-unencrypted-queue': 'off',
	'sonarjs/jsx-no-leaked-render': 'off',
	'sonarjs/no-angular-bypass-sanitization': 'off',
	'sonarjs/no-debounce-throttle-in-render': 'off',
	'sonarjs/no-hook-setter-in-body': 'off',
	'sonarjs/no-mutate-reactive-state-in-updated-hook': 'off',
	'sonarjs/no-uniq-key': 'off',
	'sonarjs/no-useless-react-setstate': 'off',
	'sonarjs/no-vue-class-component': 'off',
	'sonarjs/no-vue-mixins': 'off',
	'sonarjs/prefer-read-only-props': 'off',
}
