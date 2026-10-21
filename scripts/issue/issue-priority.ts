import { expected_effect_lint } from './expected-effect-lint'
import { has_label_name, PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4383: the priority `josh issue:file` applies, read from the body's one priority
// declaration under its background heading (`issue-template.md` holds the criteria). An urgent or high
// declaration must name its basis, so neither label is applied on a bare word. A run-time-shortening
// Issue's reduction-per-merge line sets a floor — its share of the median lane time per merge — and
// a declaration below that floor is refused. A priority label the filer typed (`kickoff new critical`)
// wins: the body is then not judged at all.

type PriorityLevel = 'critical' | 'high' | 'normal'

interface LevelParser {
	pattern: RegExp
	level: PriorityLevel
	accepts: (basis: string) => boolean
}

const BACKGROUND_HEADING = '## 背景'
const DECLARATION_PREFIX = '- 優先度:'
const NORMAL_LINE = '- 優先度: 通常'
const CRITICAL_PATTERN = /^- 優先度: 緊急（(?<basis>.*)）$/u
const HIGH_PATTERN = /^- 優先度: 高（(?<basis>.*)）$/u
// An interrupt-filing condition number (`wip-cap.md`) or a stated reduction.
const CRITICAL_BASIS = /条件 ?[1-3]|短縮 ?\d/u
const PLACEHOLDER = /^<.*>$/u
const REDUCTION_PREFIX = '- 1 マージあたりの短縮:'
// A number with its percent sign, half- or full-width, glued to the word before it or not, one space
// before the sign or none.
const PERCENT = /(?<![\d.])(?<value>[\d.]+) ?[%％]/gu
const CRITICAL_PERCENT = 10
const HIGH_PERCENT = 3
const LEVELS: ReadonlyArray<PriorityLevel> = ['normal', 'high', 'critical']
const LABELS: Readonly<Record<PriorityLevel, string | undefined>> = {
	critical: PRIORITY_CRITICAL_LABEL,
	high: PRIORITY_HIGH_LABEL,
	normal: undefined,
}
const DECLARATION_PROBLEM = `declare at most one priority under \`${BACKGROUND_HEADING}\`: \`- 優先度: 緊急（条件 <1-3> / 短縮 <値>）\`, \`- 優先度: 高（<根拠>）\` or \`${NORMAL_LINE}\` — an urgent or high one names its basis (\`issue-template.md\`)`

const REDUCTION_PROBLEM = `a \`${expected_effect_lint.DECLARATION_LINE}\` Issue states \`${REDUCTION_PREFIX} <分>（レーン中央値 <分> の <%>）\` under \`${expected_effect_lint.HEADING}\` with its percentage filled in (\`issue-template.md\`)`

function unfenced_lines(body: string, heading: string): ReadonlyArray<string> {
	const section = markdown_section.section_lines(body, heading).join('\n')

	return markdown_section.unfenced_lines(section).map((line) => line.trim())
}

function has_basis(basis: string): boolean {
	const trimmed = basis.trim()

	return trimmed.length > 0 && !PLACEHOLDER.test(trimmed)
}

function has_critical_basis(basis: string): boolean {
	return CRITICAL_BASIS.test(basis)
}

const PARSERS: ReadonlyArray<LevelParser> = [
	{ pattern: CRITICAL_PATTERN, level: 'critical', accepts: has_critical_basis },
	{ pattern: HIGH_PATTERN, level: 'high', accepts: has_basis },
]

function parsed_level(parser: LevelParser, line: string): PriorityLevel | undefined {
	const basis = parser.pattern.exec(line)?.groups?.['basis'] ?? ''

	return parser.accepts(basis) ? parser.level : undefined
}

// The level one declaration line states, or `undefined` when it is malformed or names no basis.
function level_of(line: string): PriorityLevel | undefined {
	if (line === NORMAL_LINE) return 'normal'
	const parser = PARSERS.find((entry) => entry.pattern.test(line))

	return parser === undefined ? undefined : parsed_level(parser, line)
}

// `normal` when the body declares nothing, `undefined` when it declares more than one line or a bad one.
function declared_level(body: string): PriorityLevel | undefined {
	const lines = unfenced_lines(body, BACKGROUND_HEADING).filter((line) =>
		line.startsWith(DECLARATION_PREFIX),
	)

	if (lines.length === 0) return 'normal'

	return lines.length === 1 ? level_of(lines[0] ?? '') : undefined
}

// The share of the median lane time per merge the reduction line states, the last percentage on it.
function reduction_percent(body: string): number | undefined {
	const line = unfenced_lines(body, expected_effect_lint.HEADING).find((text) =>
		text.startsWith(REDUCTION_PREFIX),
	)
	const values = [...(line ?? '').matchAll(PERCENT)].map((match) => Number(match.groups?.['value']))

	return values.findLast((value) => Number.isFinite(value))
}

// The lowest level a run-time-shortening Issue may declare, from its stated reduction.
function floor_of(body: string): PriorityLevel {
	const percent = expected_effect_lint.is_target(body) ? reduction_percent(body) : undefined

	if (percent === undefined || percent < HIGH_PERCENT) return 'normal'

	return percent >= CRITICAL_PERCENT ? 'critical' : 'high'
}

function is_typed(labels: ReadonlyArray<string>): boolean {
	return (
		has_label_name(labels, PRIORITY_CRITICAL_LABEL) || has_label_name(labels, PRIORITY_HIGH_LABEL)
	)
}

// A run-time-shortening Issue must state its reduction as a percentage, or its floor could not be judged.
function has_missing_reduction(body: string): boolean {
	return expected_effect_lint.is_target(body) && reduction_percent(body) === undefined
}

function floor_problem(body: string, level: PriorityLevel): string | undefined {
	const floor = floor_of(body)

	if (LEVELS.indexOf(level) >= LEVELS.indexOf(floor)) return undefined

	return `the stated reduction per merge ranks this Issue \`${floor}\`, above its declared \`${level}\` — declare \`- 優先度: ${floor === 'critical' ? '緊急' : '高'}（短縮 …）\` (\`issue-template.md\`)`
}

// Why the filing is refused for its priority, or `undefined`. `typed` is the `--label` list.
function problem(body: string, typed: ReadonlyArray<string>): string | undefined {
	if (is_typed(typed)) return undefined
	const level = declared_level(body)

	if (level === undefined) return DECLARATION_PROBLEM
	if (has_missing_reduction(body)) return REDUCTION_PROBLEM

	return floor_problem(body, level)
}

// The labels a new Issue is filed with — the declared priority's label added unless one was typed.
function with_label(labels: ReadonlyArray<string>, body: string): ReadonlyArray<string> {
	const label = LABELS[declared_level(body) ?? 'normal']

	if (label === undefined || is_typed(labels)) return labels

	return [...labels, label]
}

const issue_priority = { declared_level, floor_of, problem, with_label }

export type { PriorityLevel }
export { issue_priority }
