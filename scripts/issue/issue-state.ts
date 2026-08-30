import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// The answer `josh issue:state` prints, kept apart from the reading and the printing so the shape of
// the report is decided by one pure function (joshuafolkken/kit#1054).
//
// The command exists because the *instructions* needed one. `gh issue view <N> --json state` is what
// an unattended epic run was told to type to confirm a delegated child, and gh answers that call
// over GraphQL — which a cloud session is refused (403). The REST endpoint is served normally, but
// it reports `open` / `closed` in lower case, so writing the REST call into the documents would have
// copied the casing rule out of `git-gh-rest-state.ts` and into prose. Routing the instruction
// through a command keeps that rule in the one place joshuafolkken/kit#1024 put it.

const NO_LABELS = '(none)'
const LABEL_SEPARATOR = ', '
const STATE_LABEL = 'state: '
const LABELS_LABEL = 'labels: '

// `state` and `labels` as `git_gh_issue_read` answers them — the field names and the casing
// `gh issue view --json` used, not REST's. A response missing `state` is not a state report, so it
// fails the parse rather than printing an empty verdict.
const label_schema = z.looseObject({ name: z.string() })

const issue_state_schema = z.looseObject({
	state: z.string(),
	labels: label_schema.array().optional(),
})

interface IssueState {
	state: string
	labels: ReadonlyArray<string>
}

// `undefined` for anything that is not a state report — malformed JSON, and equally a well-formed
// response carrying something else (`{"message":"API rate limit exceeded"}`). The shared parser
// throws on the second so a changed `gh` field stays visible to its other callers; here the two are
// the same answer, because printing either as a state is what this command exists to prevent.
function parse_issue_state(json: string): IssueState | undefined {
	try {
		const parsed = parse_json_object_safe(json, issue_state_schema)

		if (parsed === undefined) return undefined

		return { state: parsed.state, labels: (parsed.labels ?? []).map((label) => label.name) }
	} catch {
		return undefined
	}
}

// `(none)` rather than an empty tail: the caller reads this to tell a parked child from a failed one,
// and a line that simply stops after `labels:` is indistinguishable from a truncated answer.
function format_labels(labels: ReadonlyArray<string>): string {
	return labels.length === 0 ? NO_LABELS : labels.join(LABEL_SEPARATOR)
}

function format_issue_state(state: IssueState): string {
	return `${STATE_LABEL}${state.state}\n${LABELS_LABEL}${format_labels(state.labels)}`
}

const issue_state = { NO_LABELS, STATE_LABEL, LABELS_LABEL, parse_issue_state, format_issue_state }

export type { IssueState }
export { issue_state }
