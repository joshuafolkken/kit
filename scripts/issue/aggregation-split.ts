import { markdown_section } from './markdown-section'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#5190: #5162 carried "aggregate the transcripts and record it as an Issue comment"
// beside a six-file implementation; the aggregation's output filled the lane's context before the
// implementation began and cut the session. The aggregation is a mergeable result of its own, so a body
// asking for both is refused and the aggregation routed to a prior `--route split` Issue — the
// implementation Issue then starts from the comment it cites.

const CRITERIA_HEADING = '## 受け入れ条件'
const CRITERION_PREFIX = '- ['
// Recording on an Issue, not a feature that posts a PR comment: all four words name the lane's own act.
const AGGREGATION_WORDS: ReadonlyArray<string> = ['集計', 'Issue', 'コメント', '記録']
// A criterion citing the prior aggregation Issue is the implementation this rule asks for.
const ISSUE_REFERENCE = /#\d+/u
// The implementation the estimate declares: a prior aggregation Issue may add a script or two of its own.
const IMPLEMENTATION_FILES = 3
const REFUSAL = `an acceptance criterion records an aggregation as an Issue comment beside an implementation of ${String(IMPLEMENTATION_FILES)}+ files — file the aggregation as a prior Issue (\`--route split\`) and cite its comment under ## 背景 in this one; issue-template.md → "\`## 背景\` 直下の宣言と分類ラベル"`

function is_aggregation_criterion(line: string): boolean {
	const text = line.trim()

	if (!text.startsWith(CRITERION_PREFIX) || ISSUE_REFERENCE.test(text)) return false

	return AGGREGATION_WORDS.every((word) => text.includes(word))
}

function has_aggregation_criterion(body: string): boolean {
	const criteria = markdown_section.section_lines(body, CRITERIA_HEADING).join('\n')

	return markdown_section.unfenced_lines(criteria).some((line) => is_aggregation_criterion(line))
}

function declares_implementation(body: string): boolean {
	return (size_estimate.declared_files(body) ?? 0) >= IMPLEMENTATION_FILES
}

// The refusal for a body carrying both; empty for an aggregation alone or an implementation alone.
function problems(body: string): ReadonlyArray<string> {
	return has_aggregation_criterion(body) && declares_implementation(body) ? [REFUSAL] : []
}

const aggregation_split = { IMPLEMENTATION_FILES, problems }

export { aggregation_split }
