import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_etag_read } from './git-gh-etag-read'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#6560: a read sent with the ETag the previous josh process kept on disk, so a
// listing or a body that has not changed since costs no rate limit.

const PATH = 'repos/{owner}/{repo}/issues/7'
const ETAG = 'W/"first"'
const NEW_ETAG = 'W/"second"'
const BODY = '{"number":7}'
const NEW_BODY = '{"number":7,"title":"moved"}'
const BAD_GATEWAY = 'HTTP 502'

const UNCHANGED: ConditionalRead = { kind: 'unchanged' }

function answer_with(...answers: Array<ConditionalRead>): void {
	const mocked = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) mocked.mockResolvedValueOnce(answer)
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

async function read_times(count: number): Promise<Array<string>> {
	const bodies: Array<string> = []

	for (let index = 0; index < count; index += 1) {
		// eslint-disable-next-line no-await-in-loop -- each read depends on what the previous one kept
		bodies.push(await git_gh_etag_read.read(PATH))
	}

	return bodies
}

beforeEach(() => {
	vi.restoreAllMocks()

	return shared_cache_fixture.isolate_shared_cache(git_gh_etag_read.slot_of(PATH))
})

describe('git_gh_etag_read.read — the previous ETag', () => {
	it('sends no ETag on the first read and answers its body', async () => {
		answer_with({ kind: 'changed', etag: ETAG, body: BODY })

		expect(await read_times(1)).toStrictEqual([BODY])
		expect(sent_etags()).toStrictEqual([undefined])
	})

	it('sends the kept ETag and answers the kept body on a 304', async () => {
		answer_with({ kind: 'changed', etag: ETAG, body: BODY }, UNCHANGED)

		expect(await read_times(2)).toStrictEqual([BODY, BODY])
		expect(sent_etags()).toStrictEqual([undefined, ETAG])
	})

	it('answers the new body when it changed, and keeps its ETag', async () => {
		answer_with(
			{ kind: 'changed', etag: ETAG, body: BODY },
			{ kind: 'changed', etag: NEW_ETAG, body: NEW_BODY },
			UNCHANGED,
		)

		expect(await read_times(3)).toStrictEqual([BODY, NEW_BODY, NEW_BODY])
		expect(sent_etags()).toStrictEqual([undefined, ETAG, NEW_ETAG])
	})

	it('keeps nothing from an answer without an ETag', async () => {
		answer_with(
			{ kind: 'changed', etag: undefined, body: BODY },
			{
				kind: 'changed',
				etag: undefined,
				body: NEW_BODY,
			},
		)

		expect(await read_times(2)).toStrictEqual([BODY, NEW_BODY])
		expect(sent_etags()).toStrictEqual([undefined, undefined])
	})
})

// joshuafolkken/kit#7226: `backlog:drive` asks whether the listing changed since the previous process.
describe('git_gh_etag_read.read_detail — whether the body changed', () => {
	it('answers the kept body as unchanged on a 304 with the kept ETag', async () => {
		answer_with({ kind: 'changed', etag: ETAG, body: BODY }, UNCHANGED)

		await git_gh_etag_read.read_detail(PATH)

		expect(await git_gh_etag_read.read_detail(PATH)).toStrictEqual({
			body: BODY,
			is_unchanged: true,
		})
		expect(sent_etags()).toStrictEqual([undefined, ETAG])
	})

	it('answers the new body as changed and keeps its ETag', async () => {
		answer_with(
			{ kind: 'changed', etag: ETAG, body: BODY },
			{ kind: 'changed', etag: NEW_ETAG, body: NEW_BODY },
			UNCHANGED,
		)

		await git_gh_etag_read.read_detail(PATH)

		expect(await git_gh_etag_read.read_detail(PATH)).toStrictEqual({
			body: NEW_BODY,
			is_unchanged: false,
		})
		expect(await git_gh_etag_read.read_detail(PATH)).toStrictEqual({
			body: NEW_BODY,
			is_unchanged: true,
		})
		expect(sent_etags()).toStrictEqual([undefined, ETAG, NEW_ETAG])
	})
})

// joshuafolkken/kit#6754: a lookup inside a hook's own timeout bounds its request.
describe('git_gh_etag_read.read — the timeout', () => {
	it("passes the caller's timeout to the conditional request", async () => {
		const timeout_ms = 5000

		answer_with({ kind: 'changed', etag: ETAG, body: BODY })
		await git_gh_etag_read.read(PATH, timeout_ms)

		expect(git_gh_conditional.read_conditional).toHaveBeenCalledWith(PATH, undefined, timeout_ms)
	})
})

describe('git_gh_etag_read.read — a failure', () => {
	// The classified issue reads tell a missing number from a gap by the failure's own status.
	it("throws gh's own failure", async () => {
		const cause = new Error(BAD_GATEWAY)

		answer_with({ kind: 'unreadable', cause })

		await expect(git_gh_etag_read.read(PATH)).rejects.toBe(cause)
	})

	it('throws an error naming the path when there was no failure to throw', async () => {
		answer_with({ kind: 'unreadable' })

		await expect(git_gh_etag_read.read(PATH)).rejects.toThrow(PATH)
	})

	it('throws on a 304 with nothing kept to answer', async () => {
		answer_with(UNCHANGED)

		await expect(git_gh_etag_read.read(PATH)).rejects.toThrow(PATH)
	})
})

// joshuafolkken/kit#6699: the first page through the ETag layer, every page once it is full.
const LISTING_PATH = 'repos/{owner}/{repo}/pulls?state=open&per_page=2'
const PER_PAGE = 2
const ONE_ROW = '[{"number":1}]'
const TWO_ROWS = '[{"number":1},{"number":2}]'
const ALL_PAGES = '[{"number":1},{"number":2}][{"number":3}]'

function isolate_listing(): () => void {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(ALL_PAGES)

	return shared_cache_fixture.isolate_shared_cache(git_gh_etag_read.slot_of(LISTING_PATH))
}

describe('git_gh_etag_read.read_listing — the ETag', () => {
	beforeEach(isolate_listing)

	it('answers an unchanged short page from the 304 without an unconditional gh api', async () => {
		answer_with({ kind: 'changed', etag: ETAG, body: ONE_ROW }, UNCHANGED)

		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(ONE_ROW)
		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(ONE_ROW)
		expect(sent_etags()).toStrictEqual([undefined, ETAG])
		expect(git_gh_exec.exec_gh_api).not.toHaveBeenCalled()
	})

	it('answers the new page when the listing changed', async () => {
		const changed = '[{"number":5}]'

		answer_with(
			{ kind: 'changed', etag: ETAG, body: ONE_ROW },
			{ kind: 'changed', etag: NEW_ETAG, body: changed },
		)

		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(ONE_ROW)
		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(changed)
		expect(git_gh_exec.exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('git_gh_etag_read.read_listing — the page size', () => {
	beforeEach(isolate_listing)

	it('reads every page with --paginate when the first page is full', async () => {
		answer_with({ kind: 'changed', etag: ETAG, body: TWO_ROWS })

		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(ALL_PAGES)
		expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({
			path: LISTING_PATH,
			should_paginate: true,
		})
	})

	it('hands back an answer that is no array for the caller to reject', async () => {
		const message = '{"message":"API rate limit exceeded"}'

		answer_with({ kind: 'changed', etag: undefined, body: message })

		expect(await git_gh_etag_read.read_listing(LISTING_PATH, PER_PAGE)).toBe(message)
		expect(git_gh_exec.exec_gh_api).not.toHaveBeenCalled()
	})
})
