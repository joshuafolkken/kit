import { z } from 'zod'
import { parse_json } from './parse-json-array'

// Why one `gh api` request failed, taken from **that request** rather than from a later probe
// (joshuafolkken/kit#1690).
//
// joshuafolkken/kit#957 asked the same question by issuing a second request — `exec_gh_api_status`
// against the same path — and joshuafolkken/kit#1663 asked it again with a reachability probe fired
// after the answer was otherwise final. Both are inferences about a request that is already over: a
// connection that dropped for three hundred milliseconds fails the read and answers the probe
// `reachable`, so the failure keeps the meaning the probe gave it and not the one it had.
//
// The nature is available on the failed request itself, and structurally rather than by wording:
// `gh api` writes the **response body** to stdout, and GitHub's REST error document carries its own
// status — `{"message":"Not Found","documentation_url":…,"status":"404"}`. A request that never
// reached GitHub has no response body at all, so stdout is empty. That is the whole classification,
// and neither half reads gh's stderr prose, which is what joshuafolkken/kit#1024 refused to key on.

// GitHub's REST error document. Only the status is read: `message` and `documentation_url` are prose
// for a person, and every other field varies by endpoint.
//
// The status arrives as a string (`"404"`), and a number is accepted beside it so that a future
// serialization of the same field is read rather than dropped.
//
// `.catch({})` because anything at all can arrive on this path — an HTML error page from a proxy, a
// JSON array, a bare `null`. A schema that threw there would turn "the response was not GitHub's
// error document" into an exception the caller has to catch a second time, when the honest answer is
// simply that no status was reported.
const error_document_schema = z
	.object({ status: z.union([z.string(), z.number()]).optional() })
	.catch({})

// What a failed `gh api` request said about itself.
interface GhFailure {
	// The HTTP status GitHub reported in the error document it wrote. `undefined` is the transport
	// case: nothing answered, so there is no status to report — deliberately the same shape
	// `exec_gh_api_status` already answers `undefined` for, so `gh_reachability.classify_status` reads
	// this without a second spelling of the rule.
	status: number | undefined
	// Whether the request that failed came *after* one that had already succeeded — a second endpoint
	// for a related resource, reached only because the first answered. Such a request fails about
	// itself, so its 404 says nothing about whether the subject exists: an issue read whose blocker
	// relations then 404 on a host without that endpoint is a readable issue, not a missing one. Only
	// the caller knows which of its requests was which, so it is the caller that sets this
	// (joshuafolkken/kit#1690).
	is_followup?: boolean
}

// Attached to the thrown `Error` rather than expressed as an `Error` subclass, matching
// `has_stderr_field` / `has_stdout_field` in `git-gh-exec.ts`: every failure in `scripts/` is a bare
// `Error` distinguished by a field, and one subclass among them would be a second convention.
const GH_FAILURE_FIELD = 'gh_failure'

function has_gh_failure(error: unknown): error is Error & { gh_failure: GhFailure } {
	return error instanceof Error && Object.hasOwn(error, GH_FAILURE_FIELD)
}

// The status GitHub itself reported, or `undefined` when the request produced no response body.
//
// A body that is not GitHub's error document — an HTML error page from a proxy, a truncated
// response — answers `undefined` as well. That is the honest answer: something came back, but
// nothing in it says what the status was, and guessing one would be the inference this module
// exists to remove.
function parse_response_status(stdout: string): number | undefined {
	const document = parse_json.parse_json_object_safe(stdout, error_document_schema)
	if (document?.status === undefined) return undefined
	const status = Number(document.status)

	return Number.isSafeInteger(status) ? status : undefined
}

// The classification, from the failed request's own stdout.
function classify_stdout(stdout: string): GhFailure {
	return { status: parse_response_status(stdout) }
}

// Put the classification on the error the caller will catch, so the nature travels with the throw
// instead of being reconstructed from it.
//
// **Non-enumerable deliberately.** An error is compared, logged and serialized all over this project
// — `expect(...).rejects.toThrow(new Error(text))` compares own enumerable properties — and an
// annotation nobody asked for must not change what any of those see. `in` finds it regardless.
function attach<T extends Error>(error: T, failure: GhFailure): T {
	Object.defineProperty(error, GH_FAILURE_FIELD, {
		value: failure,
		enumerable: false,
		configurable: true,
	})

	return error
}

// What a caught error said about the request that produced it, or `undefined` when it did not come
// from a `gh api` request at all — a parse or a schema rejection, which is a read that arrived and
// could not be used.
function failure_of(error: unknown): GhFailure | undefined {
	return has_gh_failure(error) ? error.gh_failure : undefined
}

const gh_failure = { attach, classify_stdout, failure_of, parse_response_status }

export type { GhFailure }
export { gh_failure, GH_FAILURE_FIELD }
