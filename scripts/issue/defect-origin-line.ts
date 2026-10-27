import { issue_bug_label } from './issue-bug-label'
import { markdown_section } from './markdown-section'
import { reproduction_measure } from './reproduction-measure'

// The origin line a bug body declares under its background heading: the merged pull request that
// introduced the defect, or "unknown" with the reason it could not be traced. `defect:report` groups
// defects by it, so a bug filed without one is a defect nobody can attribute.

const ORIGIN_PREFIX = '- 原因:'
const PR_LINE = /^- 原因: #(?<pr>\d+)$/u
const UNKNOWN_LINE = /^- 原因: 不明（(?<reason>[^）]*)）$/u
const MISSING_ORIGIN =
	'missing origin line: a `- 種別: 不具合` body declares `- 原因: #<PR>` or `- 原因: 不明（<reason>）` under ## 背景 (`pnpm josh defect:origin <N>` lists candidates)'
const MALFORMED_ORIGIN =
	'malformed origin line: write `- 原因: #<PR>` or `- 原因: 不明（<reason>）` with a non-empty reason'
const MISSING_REPRODUCTION =
	'missing reproduction: a `- 原因: 不明（<reason>）` bug carries ## 再現 with a backticked command and its actual output in a fenced block'

type DefectOrigin = { kind: 'pr'; pr: number } | { kind: 'unknown'; reason: string }

function origin_lines(body: string): ReadonlyArray<string> {
	const background = markdown_section.section_lines(body, '## 背景').join('\n')

	return markdown_section
		.unfenced_lines(background)
		.map((line) => line.trim())
		.filter((line) => line.startsWith(ORIGIN_PREFIX))
}

function parse_unknown(line: string): DefectOrigin | undefined {
	const reason = (UNKNOWN_LINE.exec(line)?.groups?.['reason'] ?? '').trim()

	return reason === '' ? undefined : { kind: 'unknown', reason }
}

function parse_line(line: string): DefectOrigin | undefined {
	const pr = PR_LINE.exec(line)?.groups?.['pr']

	return pr === undefined ? parse_unknown(line) : { kind: 'pr', pr: Number(pr) }
}

// The declared origin, or `undefined` when the body carries no well-formed origin line.
function parse(body: string): DefectOrigin | undefined {
	const [first] = origin_lines(body)

	return first === undefined ? undefined : parse_line(first)
}

// Why a bug body's origin line is refused, or `undefined` when it is not a bug or the line is sound.
function problem(body: string): string | undefined {
	if (!issue_bug_label.is_bug_fix(body)) return undefined

	const lines = origin_lines(body)

	if (lines.length === 0) return MISSING_ORIGIN

	return lines.every((line) => parse_line(line) !== undefined) ? undefined : MALFORMED_ORIGIN
}

// An untraced bug owes the lane a way to see it: without a reproduction the run starts by
// investigating. A traced one (a pull request origin) already names where to look, so it owes none.
function reproduction_problem(body: string): string | undefined {
	if (!issue_bug_label.is_bug_fix(body) || parse(body)?.kind !== 'unknown') return undefined

	return reproduction_measure.has_command_output(body) ? undefined : MISSING_REPRODUCTION
}

const defect_origin_line = {
	MALFORMED_ORIGIN,
	MISSING_ORIGIN,
	MISSING_REPRODUCTION,
	parse,
	problem,
	reproduction_problem,
}

export type { DefectOrigin }
export { defect_origin_line }
