// The casing rule between REST and `gh --json`, and the one spelling of a merged pull request.
//
// REST answers `open` / `closed` in lower case and reports a merge as a *separate* field, while `gh`
// answered `OPEN` / `CLOSED` / `MERGED` and every reader downstream compares against that spelling.
// Two endpoints have to recompose the third value from different fields — the issue endpoint from
// `pull_request.merged_at`, the pulls endpoint from `merged` — so the rule they share is named here
// rather than in either of them (joshuafolkken/kit#1027).
const MERGED_STATE = 'MERGED'

function to_gh_state(state: string | undefined): string | undefined {
	return state?.toUpperCase()
}

export { MERGED_STATE, to_gh_state }
