import { code_quality_rules, code_quality_test_rules } from '#eslint/rules/code-quality.js'
import { JAPANESE_RATIONALE_DIRECTORY } from '#eslint/rules/english-only-prose.js'
import { sonarjs_rules } from '#eslint/rules/sonarjs.js'
import { refactor_lint } from '#scripts/refactor/refactor-lint'
import { z } from 'zod'
import { derived_artifacts } from './derived-artifacts'

// A document states the limits the lint config enforces; restating them by hand drifted twice
// (joshuafolkken/kit#1070), so the statement is generated from the rule objects instead (#6035). Only
// the inline span between `<!-- lint: <name> -->` and `<!-- /lint -->` is generated — the sentence
// around it stays hand-written prose — and a stale-page test failure names REGENERATE_COMMAND.

const REGENERATE_COMMAND = derived_artifacts.DERIVE_COMMAND
const LINT_PROSE_PAGES: ReadonlyArray<string> = [
	'CLAUDE.md',
	'prompts/coding-standards.md',
	'prompts/refactoring.md',
]
const LINT_SPAN = /<!-- lint: (?<name>\S+) -->.*?<!-- \/lint -->/gu

// The two rules whose unit is a line: the documents call it a code line, so both must skip blank
// lines and comments, or the generated sentence would describe a count the gate does not make.
const MAX_LINES_PER_FUNCTION = 'max-lines-per-function'
const LINE_RULES: ReadonlyArray<string> = ['max-lines', MAX_LINES_PER_FUNCTION]

type RuleSet = Readonly<Record<string, unknown>>

const NUMBER_LIMIT = z.tuple([z.string(), z.number()])
const CODE_LINE_LIMIT = z.tuple([
	z.string(),
	z.object({ max: z.number(), skipBlankLines: z.literal(true), skipComments: z.literal(true) }),
])

function number_limit(rules: RuleSet, name: string): string {
	return String(NUMBER_LIMIT.parse(rules[name])[1])
}

function code_line_limit(rules: RuleSet, name: string): string {
	const parsed = CODE_LINE_LIMIT.safeParse(rules[name])
	if (!parsed.success) throw new Error(`\`${name}\` must skip blank lines and comments`)

	return String(parsed.data[1].max)
}

function quality_limits(): string {
	const rules = code_quality_rules
	const limits = [
		`Function complexity ≤${number_limit(rules, 'complexity')}`,
		`nesting ≤${number_limit(rules, 'max-depth')}`,
		`function ≤${code_line_limit(rules, MAX_LINES_PER_FUNCTION)} lines`,
		`file ≤${code_line_limit(rules, 'max-lines')} lines`,
		`params ≤${number_limit(rules, 'max-params')}`,
		`statements per function ≤${number_limit(rules, 'max-statements')}`,
		`cognitive complexity ≤${number_limit(sonarjs_rules, 'sonarjs/cognitive-complexity')}`,
	]
	const test_lines = code_line_limit(code_quality_test_rules, MAX_LINES_PER_FUNCTION)

	return `${limits.join(' · ')} — line counts are code lines, not physical lines; test functions allow ${test_lines} code lines`
}

function line_counting(): string {
	return LINE_RULES.map((name) => {
		code_line_limit(code_quality_rules, name)

		return `\`${name}\``
	}).join(' / ')
}

// The refactoring prompt's candidate-aggregation bullet: each `refactor:scan` category with the rules
// it queries, the low-priority one marked, so the prompt can never name a rule the oracle skips.
function refactor_scan_rules(): string {
	return refactor_lint.CATEGORIES.map((category) => {
		const rules = category.rules.map((rule) => `\`${rule}\``).join(' / ')
		const marker = category.priority === 'low' ? '低優先度: ' : ''

		return `${category.label}（${marker}${rules}）`
	}).join('、')
}

function english_only_exemption(): string {
	return `\`${JAPANESE_RATIONALE_DIRECTORY}\``
}

const RENDERERS: Readonly<Record<string, () => string>> = {
	'quality-limits': quality_limits,
	'line-counting': line_counting,
	'refactor-scan-rules': refactor_scan_rules,
	'english-only-exemption': english_only_exemption,
}

function render(name: string): string {
	const renderer = RENDERERS[name]
	if (renderer === undefined) throw new Error(`no lint prose is registered for \`${name}\``)

	return `<!-- lint: ${name} -->${renderer()}<!-- /lint -->`
}

function fill_lint_spans(text: string): string {
	return text.replaceAll(LINT_SPAN, (_span, name: string) => render(name))
}

function lint_spans(text: string): Array<string> {
	return [...text.matchAll(LINT_SPAN)].map((match) => match.groups?.['name'] ?? '')
}

const generate_lint_prose = {
	LINT_PROSE_PAGES,
	REGENERATE_COMMAND,
	RENDERERS,
	fill_lint_spans,
	lint_spans,
}

export { generate_lint_prose }
