// What a delegated subagent was launched to do, read from its own transcript (joshuafolkken/kit#1912).
//
// The launch cost block already says what each unit cost; the ranking in the diag skill needs to know
// which kind of unit it was, because a review's fixed cost is weighed against a review's saving and an
// investigation's against an investigation's. The two the workflow forks are a `/code-review` pass and
// a pre-implementation investigation, and each carries a marker specific to how it was briefed.
//
// **It is best effort, and `unknown` is the honest default** — item 6 asks for the purpose *when it can
// be estimated*. The markers are specific command and brief strings rather than loose keywords, and a
// unit that matches none is `unknown` rather than guessed, so a re-worded brief degrades to unknown
// instead of being mislabelled. Review is tested first because an investigation into review tooling can
// legitimately mention both.

type UnitPurpose = 'review' | 'investigation' | 'unknown'

// `review:brief` is the exact command a forked review runs; `/code-review` is the skill it invokes.
const REVIEW_MARKERS = ['review:brief', '/code-review']
// The return contract every investigation brief carries (SKILL.md §2b): the conclusion plus its
// `file:line` citations, never the file text.
const INVESTIGATION_MARKERS = ['Return ONLY your conclusions', 'file:line']

function has_any(raw: string, markers: ReadonlyArray<string>): boolean {
	return markers.some((marker) => raw.includes(marker))
}

function classify(raw: string): UnitPurpose {
	if (has_any(raw, REVIEW_MARKERS)) return 'review'
	if (has_any(raw, INVESTIGATION_MARKERS)) return 'investigation'

	return 'unknown'
}

const UNKNOWN_PURPOSE: UnitPurpose = 'unknown'

const time_unit_purpose = { classify, UNKNOWN_PURPOSE }

export type { UnitPurpose }
export { time_unit_purpose }
