import { acceptance_map } from '#scripts/review/acceptance-map'
import { issue_sample_gate } from './issue-sample-gate'
import { measure_declaration } from './measure-declaration'
import { size_estimate } from './size-estimate'

// joshuafolkken/kit#4901: a follow-up that measures a pull request's effect reads records that only
// the merges after it write. Filed without its start condition, the backlog offers it at once and the
// lane finds no sample (#4897). It is refused until it declares the condition (`measurement.md`).
//
// A measurement follow-up is a body carrying a measure declaration, or one changing no file whose criterion
// reads the period after a cited change — whichever record it reads it with (`lane:stats`,
// `actions/runs`, `ship --log`, …), so the reading is matched, never the reader (#5103). A record read
// that cites nothing (a CI investigation) waits on no merge, so it files as before.

const AFTER_CITED_CHANGE = /#[1-9]\d*\s*(?:を閉じる PR\s*)?(?:の\s*)?(?:マージ)?(?:後|以降)/u
const MISSING = `measurement follow-up without its start condition: declare \`${issue_sample_gate.DECLARATION}\`, or \`${issue_sample_gate.CLOSING_FORMAT}\` before that pull request exists, under ## 背景 — prompts/collaboration-workflow/measurement.md → "効果を測る後続 Issue"`

function is_measurement(body: string): boolean {
	if (measure_declaration.parse(body) !== undefined) return true
	if (size_estimate.declared_files(body) !== 0) return false

	return acceptance_map
		.criteria_of(body)
		.some((criterion) => AFTER_CITED_CHANGE.test(criterion.text))
}

// The refusal for a measurement follow-up whose start condition does not parse — missing, or
// malformed beside `issue_sample_gate.problems`' format refusal; `undefined` for any other filing.
function problem(body: string): string | undefined {
	if (!is_measurement(body)) return undefined

	return issue_sample_gate.cited_number(body) === undefined ? MISSING : undefined
}

const issue_sample_required = { problem }

export { issue_sample_required }
