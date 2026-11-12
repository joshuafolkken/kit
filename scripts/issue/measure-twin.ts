import type { BacklogIssue } from '#scripts/epic/epic-bundle'
import { measure_declaration } from './measure-declaration'
import { session_cite } from './session-cite'

// joshuafolkken/kit#6008: four follow-ups filed one measurement declaration word for word, so one
// measurement waited and was investigated four times. A draft whose declaration, normalized by
// `parse` → `format`, equals an open issue's is the same measurement — the change asking for it joins
// that issue instead.

function key_of(body: string): string | undefined {
	const declaration = measure_declaration.parse(body)

	return declaration === undefined ? undefined : measure_declaration.format(declaration)
}

// The open issues declaring the draft's measurement; `[]` when the draft declares none.
function twins_of(body: string, issues: ReadonlyArray<BacklogIssue>): ReadonlyArray<number> {
	const key = key_of(body)

	if (key === undefined) return []

	return issues.filter((issue) => key_of(issue.body) === key).map((issue) => issue.number)
}

function problem(twins: ReadonlyArray<number>): string | undefined {
	if (twins.length === 0) return undefined
	const listed = twins.map((twin) => session_cite.issue(twin)).join(', ')

	return `open issue(s) ${listed} already declare this \`${measure_declaration.PREFIX}\` — do not file it again; add this change to that issue's acceptance criteria with \`pnpm josh issue:comment <N>\`.`
}

const measure_twin = {
	problem,
	twins_of,
}

export { measure_twin }
