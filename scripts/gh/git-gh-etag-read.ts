import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'

// A `gh api` GET sent with the ETag of the answer the previous josh process read, kept on disk
// (joshuafolkken/kit#6560). `backlog:next` and `issue:scout` each run as a fresh process a minute or
// a filing apart, so an in-process memo never sees its own second read; a `304 Not Modified` costs
// nothing against the rate limit, so a listing or a body that has not changed since is free.
//
// **One record per path.** A `shared_cache` slot holds one key, so each path gets its own slot,
// named by the path's digest because the path itself is no file name.

const SLOT_PREFIX = 'josh-gh-etag-'
const PATH_DIGEST_LENGTH = 16
const HOURS_KEPT = 24
const MS_PER_HOUR = 3_600_000
const UNREADABLE_MESSAGE = 'gh api could not read'

const kept_schema = z.object({ etag: z.string(), body: z.string() })

type KeptAnswer = z.infer<typeof kept_schema>

interface SettledAnswer {
	body: string
	kept?: KeptAnswer
}

// A body read with the ETag of a previous answer, saying whether it is that previous one — the shape
// both the disk read here and the merge gate's in-process read answer (joshuafolkken/kit#7226).
interface ReadDetail {
	body: string
	is_unchanged: boolean
}

// The body an answer stands for — the previous one where GitHub says it has not changed — and what to
// keep for the next read. `undefined` is an answer with no body to give.
function settle(
	previous: KeptAnswer | undefined,
	answer: ConditionalRead,
): SettledAnswer | undefined {
	if (previous !== undefined && answer.kind === 'unchanged') return { body: previous.body }
	if (answer.kind !== 'changed') return undefined
	if (answer.etag === undefined) return { body: answer.body }

	return { body: answer.body, kept: { etag: answer.etag, body: answer.body } }
}

function slot_of(path: string): CacheSlot {
	const name = stamp_file.digest(path).slice(0, PATH_DIGEST_LENGTH)

	return { prefix: `${SLOT_PREFIX}${name}-`, ttl_ms: HOURS_KEPT * MS_PER_HOUR }
}

// gh's own failure is what is thrown, so a caller classifying it by status reads the same error the
// unconditional read threw.
function unreadable(path: string, answer: ConditionalRead): unknown {
	const cause = answer.kind === 'unreadable' ? answer.cause : undefined

	return cause ?? new Error(`${UNREADABLE_MESSAGE}: ${path}`)
}

// The answer for `path`, or the previous process's where GitHub says it has not changed, saying which.
// A failure throws, the contract `exec_gh_api` has. `timeout_ms` bounds the request as
// `exec_gh_api`'s does.
async function read_detail(path: string, timeout_ms?: number): Promise<ReadDetail> {
	const slot = slot_of(path)
	const previous = shared_cache.read(slot, path, kept_schema, Date.now())
	const answer = await git_gh_conditional.read_conditional(path, previous?.etag, timeout_ms)
	const settled = settle(previous, answer)

	if (settled === undefined) throw unreadable(path, answer)
	if (settled.kept !== undefined) shared_cache.write(slot, path, settled.kept, Date.now())

	return { body: settled.body, is_unchanged: answer.kind === 'unchanged' }
}

// `read_detail`'s body alone.
async function read(path: string, timeout_ms?: number): Promise<string> {
	const { body } = await read_detail(path, timeout_ms)

	return body
}

// A listing whose first page holds `per_page` rows (joshuafolkken/kit#6699). The ETag covers one page
// only, so a full first page — more may follow — is read unconditionally with `--paginate` instead;
// an answer that is no array is handed back for the caller's own parser to reject. `read_page` reads
// the first page: the merge gate passes its in-process read (joshuafolkken/kit#6756).
async function read_listing(
	path: string,
	per_page: number,
	read_page: (page_path: string) => Promise<string> = read,
): Promise<string> {
	const first = await read_page(path)
	const rows = parse_json_array_or_undefined(first, z.unknown())

	if (rows === undefined || rows.length < per_page) return first

	return await git_gh_exec.exec_gh_api({ path, should_paginate: true })
}

const git_gh_etag_read = { read, read_detail, read_listing, settle, slot_of }

export type { KeptAnswer, ReadDetail }
export { git_gh_etag_read }
