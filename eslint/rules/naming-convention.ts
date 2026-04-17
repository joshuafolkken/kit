export const naming_convention_rules = {
	'@typescript-eslint/naming-convention': [
		'error',
		// 変数は snake_case
		{
			selector: 'variable',
			format: ['snake_case'],
			leadingUnderscore: 'allow',
			trailingUnderscore: 'forbid',
		},
		// エクスポートされる名前空間オブジェクトや関数定数はデフォルトで snake_case
		{
			selector: 'variable',
			modifiers: ['const', 'exported'],
			format: ['snake_case', 'UPPER_CASE'],
		},
		// エクスポートされる定数（プリミティブ値）は UPPER_CASE
		{
			selector: 'variable',
			modifiers: ['const', 'exported'],
			types: ['boolean', 'string', 'number', 'array'],
			format: ['UPPER_CASE'],
		},
		// ローカルの定数（const）は UPPER_CASE または snake_case を許容
		{
			selector: 'variable',
			modifiers: ['const'],
			format: ['UPPER_CASE', 'snake_case'],
			leadingUnderscore: 'allow',
		},
		// boolean 変数は is_, has_, should_ などで始める
		{
			selector: 'variable',
			types: ['boolean'],
			format: ['snake_case'],
			prefix: ['is_', 'has_', 'should_', 'can_', 'will_', 'did_'],
		},
		// 関数は snake_case
		{
			selector: 'function',
			format: ['snake_case'],
			leadingUnderscore: 'allow',
		},
		// パラメータは snake_case
		{
			selector: 'parameter',
			format: ['snake_case'],
			leadingUnderscore: 'allow',
			trailingUnderscore: 'allow',
		},
		// クラス、インターフェース、型エイリアス、Enum は PascalCase
		{
			selector: 'typeLike',
			format: ['PascalCase'],
		},
		// Enum メンバーは UPPER_CASE
		{
			selector: 'enumMember',
			format: ['UPPER_CASE'],
		},
		// クラスのプロパティは snake_case
		{
			selector: 'classProperty',
			format: ['snake_case'],
			leadingUnderscore: 'allow',
		},
		// クラスのメソッドは snake_case
		{
			selector: 'classMethod',
			format: ['snake_case'],
			leadingUnderscore: 'allow',
		},
		// オブジェクトリテラルのプロパティは snake_case（外部APIとの互換性のため例外を許可）
		{
			selector: 'objectLiteralProperty',
			format: ['snake_case', 'UPPER_CASE', 'camelCase'],
			leadingUnderscore: 'allow',
			filter: {
				// 一般的な HTTP ヘッダー名のパターンのみ許可
				regex:
					'^(Content-Type|Accept|Accept-Language|Authorization|Cache-Control|Connection|Cookie|Host|Origin|Referer|User-Agent|X-[A-Za-z-]+|x[a-z]-[a-z-]+|[a-z-/]+|redirectTo|emailRedirectTo)$',
				match: false,
			},
		},
		// 型プロパティは snake_case
		{
			selector: 'typeProperty',
			format: ['snake_case'],
		},
	],
}
