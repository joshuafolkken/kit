// Whether GitHub answered at all — the question a failed read has to ask before it calls itself a
// structural failure (joshuafolkken/kit#1663).
//
// **The question is now asked of the failed request itself, not of a later one**
// (joshuafolkken/kit#1690). `probe()` used to fire one request at `rate_limit` after the reads were
// over and the answer otherwise final; a connection that dropped for a few hundred milliseconds
// failed a read at t=0 and answered that probe `reachable`, so the run kept the verdict the probe
// gave it rather than the one the read had. What remains here is the classification — status to
// retryable-or-not — which `git-gh-issue-read.ts` applies to the status the failed request carried
// on its own error document.
//
// A dropped connection, a name that would not resolve, a rate limit and a 5xx are **retryable**: the
// same request a moment later can succeed, and nothing about the repository has to change first. A
// 404 or a 401 is not — the issue is absent or the credentials are wrong, and asking again answers
// the same. Callers that cannot tell the two apart have to choose one meaning for both, and
// joshuafolkken/kit#1663 measured what that costs: an unattended run reported thirteen runnable
// issues as an unresolvable dependency graph because DNS hiccuped once.
//
// **It classifies by status code and not by gh's wording**, which is the same argument
// `issue_view_json_classified` records for separating 404 from the rest: a message is prose that can
// be reworded between releases, while the status is the protocol. The transport case is the one the
// protocol expresses by *absence* — no status line at all — which is exactly what
// `exec_gh_api_status` already answers `undefined` for.

// **403 is deliberately not retryable.** GitHub does spell some secondary rate limits that way, but
// it is equally how a SAML-SSO-unauthorized token, an IP allowlist and an org policy each answer —
// all permanent, and all diagnosed correctly by the `gh auth status` advice the unusable-graph
// report already carries. Reading one of those as a connection problem would be this Issue's own
// misdirection pointed the other way, so the ambiguous status is left with the permanent meaning and
// only the unambiguous ones — 429, 5xx, and no answer at all — are treated as worth asking again.
const RATE_LIMITED_STATUS = 429
const SERVER_ERROR_FLOOR = 500

// `unreachable` is a statement about the transport, never about the caller's own request: it says
// the probe could not get an answer out of GitHub, and deliberately not that any particular read
// would have succeeded had it.
type GhReachability = 'reachable' | 'unreachable'

function is_retryable_status(status: number): boolean {
	if (status >= SERVER_ERROR_FLOOR) return true

	return status === RATE_LIMITED_STATUS
}

// `undefined` is the transport case rather than an unknown one: a failed `gh api` request that wrote
// no response body has no status to report, which a request that never arrived is exactly — the same
// meaning `exec_gh_api_status` gives it when no status line was reached.
function classify_status(status: number | undefined): GhReachability {
	if (status === undefined) return 'unreachable'

	return is_retryable_status(status) ? 'unreachable' : 'reachable'
}

const gh_reachability = { classify_status }

export { gh_reachability }
export type { GhReachability }
