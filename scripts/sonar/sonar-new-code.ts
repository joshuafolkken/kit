// Whether a pull request adds any new SonarCloud finding — computed from the counts rather than from
// the Quality Gate.
//
// The built-in `Sonar way` gate judges a ratio and a rating, not a count: a few MINOR code smells keep
// the maintainability rating at A, and a copied block in a large pull request stays under the 3%
// duplication threshold. So a pull request could add both and the `SonarQube` check stayed green. The
// verdict here is a count: one new issue of any type or severity, or one new duplicated block, is a
// finding. An issue resolved in SonarCloud (accepted, false positive) is not counted — the fetch asks
// for unresolved issues only — so that resolution stays the escape hatch for a deliberate exception.

const CLEAN = 'clean'
const FINDINGS = 'findings'
// The fetch could not be read — told apart from a clean read so a failed request never passes the
// check as "no findings".
const UNREADABLE = 'unreadable'

const NEW_CODE_VERDICTS = [CLEAN, FINDINGS, UNREADABLE] as const

type NewCodeVerdict = (typeof NEW_CODE_VERDICTS)[number]

// One issue as `api/issues/search` returns it; only the fields the report prints are declared.
// The optional fields carry `| undefined` explicitly so the zod-parsed shape assigns to this type
// under `exactOptionalPropertyTypes`.
interface NewCodeIssue {
	rule: string
	severity?: string | undefined
	type?: string | undefined
	component: string
	line?: number | undefined
	message: string
}

// What the pull request's analysis holds: the unresolved issues (`issue_total` is the API's own count,
// which can exceed the page `issues` carries) and the `new_duplicated_blocks` measure.
interface NewCodeReading {
	issues: ReadonlyArray<NewCodeIssue>
	issue_total: number
	duplicated_blocks: number
}

type NewCodeFetch = NewCodeReading | { error: string }

// A measure as `api/measures/component` returns it. A `new_*` metric carries its value under
// `periods`; any other metric carries a top-level `value`.
interface SonarMeasure {
	value?: string | undefined
	periods?: ReadonlyArray<{ value?: string | undefined }> | undefined
}

function to_count(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined

	const value = Number(raw)

	return Number.isFinite(value) ? value : undefined
}

// The numeric value of a measure, or `undefined` when it is present but not a number. A measure the
// response leaves out is 0: SonarCloud omits a metric it has nothing to count on, such as a pull
// request that changes no analyzable file.
function measure_value(measure: SonarMeasure | undefined): number | undefined {
	if (measure === undefined) return 0

	return to_count(measure.periods?.[0]?.value ?? measure.value)
}

function verdict_of(fetch: NewCodeFetch): NewCodeVerdict {
	if ('error' in fetch) return UNREADABLE

	return fetch.issue_total > 0 || fetch.duplicated_blocks > 0 ? FINDINGS : CLEAN
}

const sonar_new_code = {
	measure_value,
	verdict_of,
}

export { sonar_new_code, CLEAN, FINDINGS, UNREADABLE, NEW_CODE_VERDICTS }
export type { NewCodeFetch, NewCodeIssue, NewCodeReading, NewCodeVerdict, SonarMeasure }
