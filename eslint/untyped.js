import ts from 'typescript-eslint'
import { naming_convention_rules } from './rules/naming-convention.js'
import { untyped_environment } from './untyped-environment.js'

// joshuafolkken/kit#6768: the config the edit-time eslint runs — the `PostToolUse` hook, `josh
// lint:related` and the pre-commit hook, all through the checkout's warm `eslint_d` — without a
// TypeScript program. A typed program per checkout stayed resident in each daemon, and with one
// daemon per lane those programs were what the lanes' memory went to. Typed findings are left to
// the gate's own lint, which runs cold and never sets the switch (`./untyped-environment.js`).
const { is_requested } = untyped_environment

const NAMING_CONVENTION = '@typescript-eslint/naming-convention'

// Rules that read the type program when one is there and guess without it — each reported code the
// typed config passes when this repository's tree was linted both ways. Off here, they stay the gate's.
const TYPE_GUESSING_RULES = [
	'sonarjs/no-redundant-optional',
	'unicorn/no-array-callback-reference',
	'unicorn/no-for-each',
	'unicorn/no-return-array-push',
	'unicorn/prefer-await',
	'unicorn/prefer-default-parameters',
	'unicorn/prefer-includes-over-repeated-comparisons',
	'unicorn/prefer-minimal-ternary',
	'unicorn/prefer-string-raw',
	'unicorn/prefer-top-level-await',
]

// A `types` selector asks the type checker what a name holds, and typescript-eslint throws on the
// first file when no program answers. The selector's names are still checked by the ones beside it.
// Filtered where the rule is set rather than overridden after it, so the blocks that switch the rule
// off for some files still do.
function naming_convention(variables) {
	if (!is_requested(variables)) return naming_convention_rules
	const [severity, ...selectors] = naming_convention_rules[NAMING_CONVENTION]

	return {
		[NAMING_CONVENTION]: [severity, ...selectors.filter((selector) => !('types' in selector))],
	}
}

// Appended after every other block of the shared config, so no earlier block — the test files' own
// re-enabled promise rules included — brings a typed rule back. Every rule here is only switched off.
// A disable comment for a typed rule has nothing left to suppress, so it is not reported as unused.
function blocks(variables) {
	if (!is_requested(variables)) return []

	return [
		{
			...ts.configs.disableTypeChecked,
			linterOptions: { reportUnusedDisableDirectives: 'off' },
			rules: {
				...ts.configs.disableTypeChecked.rules,
				...Object.fromEntries(TYPE_GUESSING_RULES.map((rule) => [rule, 'off'])),
			},
		},
	]
}

export const untyped_lint = { blocks, naming_convention, TYPE_GUESSING_RULES }
