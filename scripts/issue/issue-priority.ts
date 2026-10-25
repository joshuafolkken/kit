import { expected_effect_lint } from './expected-effect-lint'
import { has_label_name, PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4383: the priority `josh issue:file` applies, read from the body's one priority
// declaration under its background heading (`issue-template.md` holds the criteria). An urgent or high
// declaration must name its basis, so neither label is applied on a bare word. A run-time-shortening
// Issue's reduction-per-merge line sets a floor — its share of the median lane time per merge — and a
// security-finding or caused-park line sets a high one (joshuafolkken/kit#4767): a declaration below the
// highest floor is refused, and a body that declares none is filed at it. A causing-lane line, the net
// minutes of the lane the Issue's defect slowed (joshuafolkken/kit#4749), sets no floor
// (joshuafolkken/kit#4870): it only ranks, and its run-time-shortening Issue is refused under the high
// reduction, which would not pay back the lane its fix takes. A priority label the filer typed
// (`kickoff new critical`) wins: the body is then not judged at all.

type PriorityLevel = 'critical' | 'high' | 'normal'

interface LevelParser {
	pattern: RegExp
	level: PriorityLevel
	accepts: (basis: string) => boolean
}

// A background line that sets a floor or ranks, its well-formed shape, and the refusal for a malformed one.
interface FloorLine {
	prefix: string
	accepts: (line: string) => boolean
	problem: string
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
const LANE_PREFIX = '- 原因のレーン:'
// The minutes are the lane's net time (`josh lane:net`), the number its Issue.
const LANE_LINE = /^- 原因のレーン: (?<minutes>\d+(?:\.\d+)?) 分（#[1-9]\d*）$/u
// The minutes one cause of an overrun lost, ranked ahead of its causing lane's (joshuafolkken/kit#4861).
// They set no floor, as the causing-lane line does not.
const CAUSE_PREFIX = '- 原因の損失:'
const CAUSE_LINE = /^- 原因の損失: (?<minutes>\d+(?:\.\d+)?) 分$/u
const SECURITY_PREFIX = '- セキュリティ:'
const PARK_PREFIX = '- 原因の park:'
const PARK_LINE = /^- 原因の park: #[1-9]\d*$/u
const LEVELS: ReadonlyArray<PriorityLevel> = ['normal', 'high', 'critical']
const LABELS: Readonly<Record<PriorityLevel, string | undefined>> = {
	critical: PRIORITY_CRITICAL_LABEL,
	high: PRIORITY_HIGH_LABEL,
	normal: undefined,
}
const DECLARATION_PROBLEM = `declare at most one priority under \`${BACKGROUND_HEADING}\`: \`- 優先度: 緊急（条件 <1-3> / 短縮 <値>）\`, \`- 優先度: 高（<根拠>）\` or \`${NORMAL_LINE}\` — an urgent or high one names its basis (\`issue-template.md\`)`

const LANE_PROBLEM = `state a causing lane under \`${BACKGROUND_HEADING}\` as \`${LANE_PREFIX} <分> 分（#<N>）\` — the lane's net minutes from \`josh lane:net <N>\` (\`issue-template.md\`)`

const CAUSE_PROBLEM = `state a cause's lost minutes under \`${BACKGROUND_HEADING}\` as \`${CAUSE_PREFIX} <分> 分\` (\`issue-template.md\`)`

const SECURITY_PROBLEM = `state a security finding under \`${BACKGROUND_HEADING}\` as \`${SECURITY_PREFIX} <迂回される gate・ガード・権限>\` (\`issue-template.md\`)`

const PARK_PROBLEM = `state a caused park under \`${BACKGROUND_HEADING}\` as \`${PARK_PREFIX} #<N>\` — the Issue the defect parked or whose run it stopped (\`issue-template.md\`)`

const FLOOR_DECLARATIONS: Readonly<Record<PriorityLevel, string>> = {
	critical: '緊急（短縮 …）',
	high: '高（短縮 … / セキュリティ … / 原因の park …）',
	normal: '通常',
}

const WHOLE_PERCENT = 100
// The merges a reduction under the high one takes to pay back one lane.
const PAYBACK_MERGES = Math.ceil(WHOLE_PERCENT / HIGH_PERCENT)

const SMALL_LANE_PROBLEM = `a \`${expected_effect_lint.DECLARATION_LINE}\` Issue with a \`${LANE_PREFIX}\` line states a \`${REDUCTION_PREFIX}\` under ${String(HIGH_PERCENT)}% — about ${String(PAYBACK_MERGES)} merges before it pays back the lane its fix takes, so it is not filed: fold it into an open Issue, or leave the cause in the overrun investigation's result note (\`issue-template.md\`)`

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

function background_lines(body: string, prefix: string): ReadonlyArray<string> {
	return unfenced_lines(body, BACKGROUND_HEADING).filter((line) => line.startsWith(prefix))
}

// `normal` when the body declares nothing, `undefined` when it declares more than one line or a bad one.
function declared_level(body: string): PriorityLevel | undefined {
	const lines = background_lines(body, DECLARATION_PREFIX)

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

// The floor a run-time-shortening Issue's stated reduction sets.
function reduction_floor(body: string): PriorityLevel {
	const percent = expected_effect_lint.is_target(body) ? reduction_percent(body) : undefined

	if (percent === undefined || percent < HIGH_PERCENT) return 'normal'

	return percent >= CRITICAL_PERCENT ? 'critical' : 'high'
}

function is_lane_line(line: string): boolean {
	return LANE_LINE.test(line)
}

function is_cause_line(line: string): boolean {
	return CAUSE_LINE.test(line)
}

function is_security_line(line: string): boolean {
	return has_basis(line.slice(SECURITY_PREFIX.length))
}

function is_park_line(line: string): boolean {
	return PARK_LINE.test(line)
}

// Read for ranking, not a floor, as the cause-loss line below is.
const LANE_RANK_LINE: FloorLine = {
	prefix: LANE_PREFIX,
	accepts: is_lane_line,
	problem: LANE_PROBLEM,
}
// H and I of `issue-template.md`'s criteria: either line ranks the Issue high.
const HIGH_FLOOR_LINES: ReadonlyArray<FloorLine> = [
	{ prefix: SECURITY_PREFIX, accepts: is_security_line, problem: SECURITY_PROBLEM },
	{ prefix: PARK_PREFIX, accepts: is_park_line, problem: PARK_PROBLEM },
]

// Read for ranking, not a floor, yet a malformed one would rank as undeclared without a word.
const CAUSE_RANK_LINE: FloorLine = {
	prefix: CAUSE_PREFIX,
	accepts: is_cause_line,
	problem: CAUSE_PROBLEM,
}

// The refusal for the first floor or rank line written in the wrong shape, or `undefined`.
function malformed_problem(body: string): string | undefined {
	return [LANE_RANK_LINE, CAUSE_RANK_LINE, ...HIGH_FLOOR_LINES].find((entry) =>
		background_lines(body, entry.prefix).some((line) => !entry.accepts(line)),
	)?.problem
}

function marker_floor(body: string): PriorityLevel {
	const is_marked = HIGH_FLOOR_LINES.some(
		(entry) => background_lines(body, entry.prefix).length > 0,
	)

	return is_marked ? 'high' : 'normal'
}

// The largest minutes the background lines of `prefix` declare in `pattern`'s shape; `0` when none do.
function declared_minutes(body: string, prefix: string, pattern: RegExp): number {
	const minutes = background_lines(body, prefix)
		.map((line) => Number(pattern.exec(line)?.groups?.['minutes']))
		.filter((value) => Number.isFinite(value))

	return Math.max(0, ...minutes)
}

// The longest causing lane the body declares, in minutes; `0` when it declares none.
function lane_minutes(body = ''): number {
	return declared_minutes(body, LANE_PREFIX, LANE_LINE)
}

// The minutes the body's cause lost, the rank backlog ordering reads: its cause-loss line, else its
// causing lane, whose net time bounds the loss from above; `0` when it declares neither.
function lost_minutes(body = ''): number {
	const cause = declared_minutes(body, CAUSE_PREFIX, CAUSE_LINE)

	return cause > 0 ? cause : lane_minutes(body)
}

// The lowest level the Issue may declare: the higher of its reduction's and markers' floors.
function floor_of(body: string): PriorityLevel {
	const floors = [reduction_floor(body), marker_floor(body)]
	const ranks = floors.map((level) => LEVELS.indexOf(level))

	return LEVELS[Math.max(...ranks)] ?? 'normal'
}

// The level the Issue is filed at: its declaration, else its floor.
function filed_level(body: string): PriorityLevel | undefined {
	return background_lines(body, DECLARATION_PREFIX).length === 0
		? floor_of(body)
		: declared_level(body)
}

function is_typed(labels: ReadonlyArray<string>): boolean {
	return (
		has_label_name(labels, PRIORITY_CRITICAL_LABEL) || has_label_name(labels, PRIORITY_HIGH_LABEL)
	)
}

// A run-time-shortening Issue must state its reduction as a percentage, or its floor could not be
// judged; one a causing lane prompted is refused under the high reduction (joshuafolkken/kit#4870).
function reduction_problem(body: string): string | undefined {
	if (!expected_effect_lint.is_target(body)) return undefined
	const percent = reduction_percent(body)

	if (percent === undefined) return REDUCTION_PROBLEM
	const is_lane = background_lines(body, LANE_PREFIX).length > 0

	return is_lane && percent < HIGH_PERCENT ? SMALL_LANE_PROBLEM : undefined
}

function floor_problem(body: string, level: PriorityLevel): string | undefined {
	const floor = floor_of(body)

	if (LEVELS.indexOf(level) >= LEVELS.indexOf(floor)) return undefined

	return `the stated reduction per merge, security finding or caused park ranks this Issue \`${floor}\`, above its declared \`${level}\` — declare \`- 優先度: ${FLOOR_DECLARATIONS[floor]}\`, or drop the declaration to file at the floor (\`issue-template.md\`)`
}

// Why the filing is refused for its priority, or `undefined`. `typed` is the `--label` list.
function problem(body: string, typed: ReadonlyArray<string>): string | undefined {
	if (is_typed(typed)) return undefined
	const level = filed_level(body)

	if (level === undefined) return DECLARATION_PROBLEM

	return reduction_problem(body) ?? malformed_problem(body) ?? floor_problem(body, level)
}

// The labels a new Issue is filed with — the filed level's label added unless one was typed.
function with_label(labels: ReadonlyArray<string>, body: string): ReadonlyArray<string> {
	const label = LABELS[filed_level(body) ?? 'normal']

	if (label === undefined || is_typed(labels)) return labels

	return [...labels, label]
}

const issue_priority = {
	CAUSE_PREFIX,
	declared_level,
	floor_of,
	HIGH_PERCENT,
	lane_minutes,
	lost_minutes,
	problem,
	with_label,
}

export type { PriorityLevel }
export { issue_priority }
