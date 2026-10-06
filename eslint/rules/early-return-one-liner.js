// early-return-one-liner: 単一の短い early return を one-liner `if (x) return y` に強制するルール
// （joshuafolkken/kit#3294）。CLAUDE.md の Quality limits は「single short early return → one-liner」と
// 書くが、`curly` は `['error', 'multi-line']` で one-liner 形を許すだけで要求はしない。そのため
// review-rubric の手作業チェックに残っていた。散文の指示はドリフトするので lint で強制する。
//
// 対象は else の無い `if` で、ブロックの中身が `return` 1 文だけのもの。ブロック内にコメントがあれば
// 対象外（one-liner にするとコメントの置き場が無くなる）。「短い」の判定は、one-liner にしたときに
// 行頭のインデントを含めて Prettier の printWidth（100）に収まるかどうか。収まらないものを
// one-liner にしても Prettier が折り返すだけなので、要求しない。条件式や戻り値が複数行にわたる
// ものも同じ理由で対象外。
//
// 自動修正はブロックを `return` 文そのものに置き換える。既存コードの移行を `--fix` 一発で済ませる
// ためで、置き換え後の形は `curly: multi-line` も Prettier もそのまま受け入れる。

const RULE_MESSAGE =
	'Write a single short early return as a one-liner: `if (x) return y`. See CLAUDE.md → Quality limits.'

// Prettier の printWidth（prettier/basic.js）と max-len の code に揃える。
const PRINT_WIDTH = 100
// Prettier の useTabs で 1 タブが占める幅（tabWidth の既定値）。max-len の tabWidth と同じ。
const TAB_WIDTH = 2

const BLOCK_STATEMENT = 'BlockStatement'
const RETURN_STATEMENT = 'ReturnStatement'

// ブロックの中身が return 1 文だけなら、その return。それ以外は undefined。
function sole_return(block) {
	const statements = block.type === BLOCK_STATEMENT ? block.body : []
	const [statement] = statements

	return statements.length === 1 && statement.type === RETURN_STATEMENT ? statement : undefined
}

// 行頭からノードの開始位置までの幅。タブは TAB_WIDTH として数える。`} else if` のように `if` が
// 行の途中から始まるときは、手前の `} else ` も 1 行に並ぶので幅に含める。
function leading_width(source_code, node) {
	const line = source_code.lines[node.loc.start.line - 1] ?? ''
	const prefix = line.slice(0, node.loc.start.column)

	return [...prefix].reduce((width, char) => width + (char === '\t' ? TAB_WIDTH : 1), 0)
}

// one-liner にしたときの `if (...) return ...` の文字列。
function one_liner_text(source_code, node, return_statement) {
	const test_text = source_code.getText(node.test)
	const return_text = source_code.getText(return_statement).replace(/;$/u, '')

	return `if (${test_text}) ${return_text}`
}

function fits_on_one_line(source_code, node, text) {
	return !text.includes('\n') && leading_width(source_code, node) + text.length <= PRINT_WIDTH
}

function has_comments(source_code, block) {
	return source_code.getCommentsInside(block).length > 0
}

// return 1 文だけの `if` が one-liner に書き直せるか。else もコメントも無く、1 行に収まるもの。
function is_one_liner_candidate(source_code, node, return_statement) {
	if (node.alternate || has_comments(source_code, node.consequent)) return false

	return fits_on_one_line(source_code, node, one_liner_text(source_code, node, return_statement))
}

function check_if_statement(context, node) {
	const { sourceCode: source_code } = context
	const return_statement = sole_return(node.consequent)

	if (!return_statement || !is_one_liner_candidate(source_code, node, return_statement)) return

	context.report({
		node,
		message: RULE_MESSAGE,
		fix: (fixer) => fixer.replaceText(node.consequent, source_code.getText(return_statement)),
	})
}

function create(context) {
	return {
		IfStatement(node) {
			check_if_statement(context, node)
		},
	}
}

/** @type {import('eslint').Rule.RuleModule} */
const early_return_one_liner_rule = {
	meta: {
		type: 'layout',
		docs: { description: 'Require a single short early return to be written as a one-liner' },
		fixable: 'code',
		schema: [],
	},
	create,
}

export { RULE_MESSAGE, early_return_one_liner_rule }
