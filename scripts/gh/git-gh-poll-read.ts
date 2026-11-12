import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { FULL_PAGE_QUERY } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_etag_read, type KeptAnswer, type ReadDetail } from './git-gh-etag-read'
import { git_gh_exec } from './git-gh-exec'

// The merge gate's per-poll reads, each sent with the ETag of this process's previous answer
// (joshuafolkken/kit#4550).
//
// **A pull request's detail says whether it was answered 304** (`read_detail`): GitHub computes its
// `mergeable_state` lazily, under an unchanged ETag, so the kept body's state can be stale and the
// caller reads it afresh (joshuafolkken/kit#4589, joshuafolkken/kit#6721).
//
// **`pnpm josh followup` repeatedly reads the same pull request** while its checks run, and
// every lane waiting on its merge does so at once. A `304 Not Modified` does not count against the
// rate limit, so a poll that finds nothing changed costs only its pull detail read.
//
// **A listing is read one page at a time only while it fits in one.** A listing longer than a page is
// read through `--paginate --slurp` as before; the conditional read cannot page, and a partial
// listing would drop checks from the verdict. A bare-array listing (`read_array_pages`, the reviews
// listing) has no `total_count`, so a first page shorter than a page is the whole one.

const UNREADABLE_POLL_MESSAGE = 'gh api could not read a merge-gate poll'
const PAGE_SIZE = 100

const kept_by_path = new Map<string, KeptAnswer>()

const page_schema = z.object({ total_count: z.number() })

// gh's own failure rides along as the cause and in the message: the poll loop's warning prints the
// message alone, and a rate limit must read differently there from expired auth.
function unreadable(path: string, answer: ConditionalRead): Error {
	const cause = answer.kind === 'unreadable' ? answer.cause : undefined
	const reason = cause === undefined ? '' : `: ${error_text.message_of(cause)}`

	return new Error(`${UNREADABLE_POLL_MESSAGE}: ${path}${reason}`, { cause })
}

// The body `answer` stands for, keeping the new one; `undefined` where it has none to give.
function settle_kept(path: string, answer: ConditionalRead): string | undefined {
	const settled = git_gh_etag_read.settle(kept_by_path.get(path), answer)

	if (settled?.kept !== undefined) kept_by_path.set(path, settled.kept)

	return settled?.body
}

async function read_answer(path: string): Promise<ConditionalRead> {
	return await git_gh_conditional.read_conditional(path, kept_by_path.get(path)?.etag)
}

// The answer for `path`, or the previous one where GitHub says it has not changed. A failure throws,
// the contract the unconditional read had.
async function read(path: string): Promise<string> {
	const answer = await read_answer(path)
	const body = settle_kept(path, answer)
	if (body === undefined) throw unreadable(path, answer)

	return body
}

// `read`, saying whether the body is the kept one. A failure answers `undefined`, so the caller falls
// back to its unconditional read and throws that read's own error.
async function read_detail(path: string): Promise<ReadDetail | undefined> {
	const answer = await read_answer(path)
	const body = settle_kept(path, answer)

	return body === undefined ? undefined : { body, is_unchanged: answer.kind === 'unchanged' }
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

// A bare-array listing (the reviews endpoint), whose pages `gh` merges into one array on its own —
// slurping it would produce `[[…],[…]]`, which the listing schema then rejects.
async function read_array_pages(path: string): Promise<string> {
	return await git_gh_etag_read.read_listing(`${path}${FULL_PAGE_QUERY}`, PAGE_SIZE, read)
}

function forget_poll_reads(): void {
	kept_by_path.clear()
}

const git_gh_poll_read = {
	UNREADABLE_POLL_MESSAGE,
	forget_poll_reads,
	read,
	read_array_pages,
	read_detail,
	read_object_pages,
}

export { git_gh_poll_read }
