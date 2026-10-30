import { split_assess, type SizeMeasurement } from '#scripts/split/split-assess'
import { z } from 'zod'
import { SPLIT_ROUTE_LABEL } from './issue-labels'
import { markdown_section } from './markdown-section'

// joshuafolkken/kit#4675: a request clearly over the split guide reached a lane as one Issue because
// nothing asked for its size when it was filed, and a split is cheapest at filing time. Every filing
// declares its estimate under the background heading, so it stays on the Issue; one over the guide is
// refused unless it is filed as a split or says why it stays one Issue.
//
// **The guide is `split_assess`'s, never a copy** — the measured diff and the declared estimate are
// judged by one `verdict_for`. An epic (a body carrying `## Split rationale`) declares no estimate:
// its children do.

const BACKGROUND_HEADING = '## 背景'
const EPIC_HEADING = '## Split rationale'
const PREFIX = '- 規模見積もり:'
const { REASON_PREFIX } = split_assess
const DECLARATION = `${PREFIX} 約 <N> ファイル / <M> 行（テスト除く）`
// Full- or half-width parentheses alike: the two read the same to the person typing the line.
const VALUE_PATTERN =
	/^約\s*(?<files>\d+)\s*ファイル\s*\/\s*(?<lines>\d+)\s*行\s*[（(]テスト除く[）)]$/u
const MISSING = `missing size estimate: declare \`${DECLARATION}\` under ${BACKGROUND_HEADING}`
// The refusal ends in a line ready to paste (joshuafolkken/kit#5225).
const EXAMPLE = `${PREFIX} 約 3 ファイル / 60 行（テスト除く）`
const MALFORMED = `\`${PREFIX}\` must be written ${DECLARATION}\n${EXAMPLE}`
const estimate_schema = z.object({ files: z.coerce.number(), lines: z.coerce.number() })

function declared(body: string, prefix: string): string | undefined {
	const background = markdown_section.section_lines(body, BACKGROUND_HEADING).join('\n')
	const line = markdown_section
		.unfenced_lines(background)
		.map((text) => text.trim())
		.find((text) => text.startsWith(prefix))

	return line?.slice(prefix.length).trim()
}

function is_epic(body: string): boolean {
	return markdown_section.has_line(body, EPIC_HEADING)
}

// The declared estimate judged against the guide, or `undefined` when there is none or it does not parse.
function parse(body: string): SizeMeasurement | undefined {
	const read = estimate_schema.safeParse(VALUE_PATTERN.exec(declared(body, PREFIX) ?? '')?.groups)

	if (!read.success) return undefined
	const { files, lines } = read.data

	return { files, lines, verdict: split_assess.verdict_for(files, lines) }
}

// The shape check `issue:lint` makes: the declaration is there and parses. The guide needs the route,
// which only `issue:file` knows, so it is `guide_problem`'s.
function problems(body: string): ReadonlyArray<string> {
	if (is_epic(body)) return []
	if (declared(body, PREFIX) === undefined) return [MISSING]

	return parse(body) === undefined ? [MALFORMED] : []
}

// A split filing, or one that declares why it stays one Issue, passes over the guide.
function is_excused(body: string, route: string | undefined): boolean {
	return route === SPLIT_ROUTE_LABEL || (declared(body, REASON_PREFIX) ?? '') !== ''
}

// The counts against the guide, shared by the filing refusal and `backlog:next`'s offer note.
function exceeded(estimate: SizeMeasurement): string {
	return `size estimate ${String(estimate.files)} file(s) / ${String(estimate.lines)} line(s) exceeds the guide (more than ${String(split_assess.FILE_GUIDE)} files or ${String(split_assess.LINE_GUIDE)} lines)`
}

function refusal(estimate: SizeMeasurement): string {
	return `${exceeded(estimate)} — file it split (\`--route split\`) or declare \`${REASON_PREFIX} <理由>\`; split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// The declared estimate when it is over the guide and not excused; `undefined` under it, on a split
// filing, with the reason declared, or with no parsable estimate. `issue:file` and `backlog:next` both
// judge through it (joshuafolkken/kit#5384).
function over_guide(body: string, route: string | undefined): SizeMeasurement | undefined {
	const estimate = parse(body)

	if (estimate?.verdict !== split_assess.SPLIT_VERDICT) return undefined

	return is_excused(body, route) ? undefined : estimate
}

// The filing refusal for an estimate over the guide. A missing or malformed estimate is `problems`'
// refusal, not this one.
function guide_problem(body: string, route: string | undefined): string | undefined {
	const estimate = over_guide(body, route)

	return estimate === undefined ? undefined : refusal(estimate)
}

// The declared file count, or `undefined` when there is no estimate or it does not parse.
function declared_files(body: string): number | undefined {
	return parse(body)?.files
}

const size_estimate = {
	declared_files,
	declared_size: parse,
	exceeded,
	guide_problem,
	over_guide,
	problems,
}

export { size_estimate }
