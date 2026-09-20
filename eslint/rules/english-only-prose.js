// Enforce the Content rule that comments and test titles are English only (Issue #2124). Every other
// convention in CLAUDE.md's Content-rules block — naming, complexity limits, magic numbers, early
// return, test filenames, the `../` import ban — is machine-enforced; this one alone stayed prose, so
// a stray Japanese comment or test title linted green and could only be caught by review. The decision
// is an AST-and-codepoint one: look at comment tokens and the title/message string literals of
// `describe` / `it` / `test` / `expect`, and report when they carry a CJK codepoint. The single
// exception is `eslint/rules/` itself, where the rule modules are allowed to explain their rationale in
// Japanese — that exemption is wired in `eslint.config.js`, not here, so the rule stays a pure detector.

// CJK codepoints: Han (Kanji), Hiragana, Katakana and Hangul. This is intentionally the "comment or
// title" alphabet, not "any non-ASCII" — a comment may legitimately carry `≤`, `→` or an accented
// name, and only the scripts a Japanese/Korean sentence is written in mark prose that must be English.
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

// The three test-title callers whose first argument is the human-readable title.
const TITLE_CALLERS = new Set(['describe', 'it', 'test'])

// vitest's `expect(actual, message)` carries the assertion message as the second positional argument.
const EXPECT_CALLER = 'expect'
const EXPECT_MESSAGE_INDEX = 1

/**
 * @param {string} text
 * @returns {boolean}
 */
function has_cjk(text) {
	return CJK_PATTERN.test(text)
}

// The callee's leading identifier, so `it`, `it.only` and `describe.skip` all resolve to their base
// name. A chained call such as `it.each(...)(...)` has a CallExpression callee and resolves to
// undefined — its title is left unchecked, which is acceptable: the ban's subject is the plain
// `describe` / `it` / `test` title, and the repository writes none of them in Japanese today.
/**
 * @param {import('estree').CallExpression} node
 * @returns {string | undefined}
 */
function callee_name(node) {
	const { callee } = node
	if (callee.type === 'Identifier') return callee.name

	const is_member = callee.type === 'MemberExpression' && callee.object.type === 'Identifier'

	return is_member ? callee.object.name : undefined
}

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined}
 */
function literal_string(node) {
	return node.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined
}

/**
 * @param {import('estree').Node} node
 * @returns {string | undefined}
 */
function template_string(node) {
	const is_plain = node.type === 'TemplateLiteral' && node.expressions.length === 0

	return is_plain ? node.quasis[0]?.value.raw : undefined
}

// The string a title/message argument carries, whether written as a quoted literal or a
// no-substitution template. Anything else (a variable, an interpolated template) is not inspected.
/**
 * @param {import('estree').Node | undefined} node
 * @returns {string | undefined}
 */
function string_value(node) {
	return node ? (literal_string(node) ?? template_string(node)) : undefined
}

// The argument that must be English for a given call: the first argument of a title caller, or the
// message argument of `expect`. A call that is neither yields undefined and is skipped.
/**
 * @param {import('estree').CallExpression} node
 * @returns {import('estree').Node | undefined}
 */
function prose_argument(node) {
	const name = callee_name(node)
	if (name !== undefined && TITLE_CALLERS.has(name)) return node.arguments[0]

	return name === EXPECT_CALLER ? node.arguments[EXPECT_MESSAGE_INDEX] : undefined
}

/** @type {import('eslint').Rule.RuleModule} */
const english_only_prose_rule = {
	meta: {
		type: 'problem',
		docs: {
			description:
				'Enforce English-only comments and test titles; CJK codepoints belong to data, not prose.',
		},
		messages: {
			comment:
				'Write this comment in English. CJK codepoints are not allowed in comments (CLAUDE.md Content rules); the only exception is eslint/rules/.',
			prose:
				'Write this test title/message in English. CJK codepoints are not allowed in describe/it/test titles or expect messages (CLAUDE.md Content rules).',
		},
		schema: [],
	},
	create(context) {
		const source = context.sourceCode

		/** @param {import('estree').Node | undefined} argument */
		function report_prose(argument) {
			if (!argument) return

			const text = string_value(argument)

			if (text !== undefined && has_cjk(text)) {
				context.report({ node: argument, messageId: 'prose' })
			}
		}

		return {
			Program() {
				for (const comment of source.getAllComments()) {
					if (has_cjk(comment.value)) context.report({ loc: comment.loc, messageId: 'comment' })
				}
			},
			CallExpression(node) {
				report_prose(prose_argument(node))
			},
		}
	},
}

// The plugin wrapper `eslint.config.js` wires under the `kit` namespace, plus the bare rule and the CJK
// pattern for the tests and the document-sync guard to read.
const english_only_prose_plugin = { rules: { 'english-only-prose': english_only_prose_rule } }

export { CJK_PATTERN, english_only_prose_rule, english_only_prose_plugin }
