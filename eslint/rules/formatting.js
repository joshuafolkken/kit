const BLANK_LINE_ALWAYS = 'always'
const BLOCK_LIKE = 'block-like'

export const formatting_rules = {
	'padding-line-between-statements': [
		'error',
		{ blankLine: BLANK_LINE_ALWAYS, prev: BLOCK_LIKE, next: '*' },
		{ blankLine: BLANK_LINE_ALWAYS, prev: '*', next: BLOCK_LIKE },
		{
			blankLine: BLANK_LINE_ALWAYS,
			prev: ['const', 'let', 'var'],
			next: BLOCK_LIKE, // interface, class, function などをカバー
		},
		{
			blankLine: BLANK_LINE_ALWAYS,
			prev: ['const', 'let', 'var'],
			next: 'expression',
		},
		{
			blankLine: BLANK_LINE_ALWAYS,
			prev: '*',
			next: ['class', 'function'],
		},
		{ blankLine: BLANK_LINE_ALWAYS, prev: '*', next: 'return' },
	],

	// @stylistic プラグインを使用して interface の前後に空行を追加
	'@stylistic/padding-line-between-statements': [
		'error',
		{ blankLine: BLANK_LINE_ALWAYS, prev: '*', next: 'interface' },
		{ blankLine: BLANK_LINE_ALWAYS, prev: 'interface', next: '*' },
		{ blankLine: 'any', prev: 'type', next: 'type' },
	],

	'lines-between-class-members': [
		'error',
		{
			enforce: [
				{ blankLine: BLANK_LINE_ALWAYS, prev: '*', next: 'method' },
				{ blankLine: 'never', prev: 'field', next: 'field' },
			],
		},
	],
}
