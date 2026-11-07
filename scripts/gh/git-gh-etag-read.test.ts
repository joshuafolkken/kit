import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_etag_read } from './git-gh-etag-read'

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
