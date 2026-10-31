import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { FULL_PAGE_QUERY } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'

// The merge gate's per-poll reads, each sent with the ETag of this process's previous answer
// (joshuafolkken/kit#4550).
//
// **Never a pull request's detail**: GitHub computes its `mergeable_state` lazily, under an unchanged
// ETag, so a 304 would keep a stale state (joshuafolkken/kit#4589).
//
// **`pnpm josh followup` repeatedly reads the same pull request** while its checks run, and
// every lane waiting on its merge does so at once. A `304 Not Modified` does not count against the
// rate limit, so a poll that finds nothing changed costs only its pull detail read.
//
// **A listing is read one page at a time only while it fits in one.** A listing longer than a page is
// read through `--paginate --slurp` as before; the conditional read cannot page, and a partial
// listing would drop checks from the verdict.

const UNREADABLE_POLL_MESSAGE = 'gh api could not read a merge-gate poll'
const PAGE_SIZE = 100

interface KeptAnswer {
	etag: string
	body: string
}

const kept_by_path = new Map<string, KeptAnswer>()

const page_schema = z.object({ total_count: z.number() })

// gh's own failure rides along as the cause and in the message: the poll loop's warning prints the
// message alone, and a rate limit must read differently there from expired auth.
function unreadable(path: string, answer: ConditionalRead): Error {
	const cause = answer.kind === 'unreadable' ? answer.cause : undefined
	const reason = cause === undefined ? '' : `: ${error_text.message_of(cause)}`

	return new Error(`${UNREADABLE_POLL_MESSAGE}: ${path}${reason}`, { cause })
}

function to_body(path: string, answer: ConditionalRead): string {
	const previous = kept_by_path.get(path)

	if (previous !== undefined && answer.kind === 'unchanged') return previous.body
	if (answer.kind !== 'changed') throw unreadable(path, answer)
	if (answer.etag !== undefined) kept_by_path.set(path, { etag: answer.etag, body: answer.body })

	return answer.body
}

// The answer for `path`, or the previous one where GitHub says it has not changed. A failure throws,
// the contract the unconditional read had.
async function read(path: string): Promise<string> {
	const answer = await git_gh_conditional.read_conditional(path, kept_by_path.get(path)?.etag)

	return to_body(path, answer)
}

// A page that does not parse as a listing is not taken as the whole one: the full read answers it, and
// its own parser reports what it was.
function is_whole_listing(page: string): boolean {
	const total = json_value.parse_with(page, page_schema)?.total_count

	return total !== undefined && total <= PAGE_SIZE
}

// A commit listing in the `--slurp` shape — an array of pages — however it was read.
async function read_object_pages(path: string): Promise<string> {
	const full_path = `${path}${FULL_PAGE_QUERY}`
	const page = await read(full_path)

	if (is_whole_listing(page)) return `[${page}]`

	return await git_gh_exec.exec_gh_api({
		path: full_path,
		should_paginate: true,
		should_slurp: true,
	})
}

function forget_poll_reads(): void {
	kept_by_path.clear()
}

const git_gh_poll_read = { UNREADABLE_POLL_MESSAGE, forget_poll_reads, read, read_object_pages }

export { git_gh_poll_read }
