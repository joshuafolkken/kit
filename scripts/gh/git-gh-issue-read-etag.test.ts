import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_issue_memo } from './git-gh-issue-memo'
import { git_gh_issue_read, read_blocked_by } from './git-gh-issue-read'
import { git_gh_issue_rest } from './git-gh-issue-rest'
import {
	BLOCKER_NUMBER,
	ISSUE_NUMBER,
	ISSUE_TITLE,
	rest_blockers,
	rest_dependencies_summary,
	rest_issue,
} from './git-gh-issue-rest-fixture'

// joshuafolkken/kit#6701: `backlog:next` reads every open blocked issue's relations each offer, each
// offer a fresh process, so the read is sent with the ETag the previous one kept. An unchanged set is
// answered 304 and costs no core request.

const READ_NUMBER = String(ISSUE_NUMBER)
const FIRST_ETAG = 'W/"first"'
const MOVED_ETAG = 'W/"moved"'
const FIRST_BLOCKERS = rest_blockers('open')
const MOVED_BLOCKERS = rest_blockers('closed')
const BLOCKED_REST = git_gh_issue_rest.parse_rest_issue(rest_issue(rest_dependencies_summary(1)))

function serve(...answers: Array<ConditionalRead>): void {
	const read = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) read.mockResolvedValueOnce(answer)
}

function sent_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

// Each read stands for the next process, which starts with no issue read remembered
// (`git-gh-issue-memo.ts`).
async function blocker_states(): Promise<Array<string>> {
	git_gh_issue_memo.forget()
	const blocked_by = await read_blocked_by(READ_NUMBER, BLOCKED_REST)

	return blocked_by.nodes.map((node) => `${String(node.number)}:${node.state}`)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
	git_gh_issue_memo.forget()
})

describe('read_blocked_by — the previous ETag', () => {
	it('sends the previous ETag and answers the previous blockers on a 304', async () => {
		const unconditional = vi.spyOn(git_gh_exec, 'exec_gh_api')

		serve({ kind: 'changed', etag: FIRST_ETAG, body: FIRST_BLOCKERS }, { kind: 'unchanged' })

		const first = await blocker_states()

		expect(await blocker_states()).toStrictEqual(first)
		expect(first).toStrictEqual([`${String(BLOCKER_NUMBER)}:OPEN`])
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
		expect(unconditional).not.toHaveBeenCalled()
	})

	it('answers the new blockers when the set changed', async () => {
		serve(
			{ kind: 'changed', etag: FIRST_ETAG, body: FIRST_BLOCKERS },
			{ kind: 'changed', etag: MOVED_ETAG, body: MOVED_BLOCKERS },
		)

		await blocker_states()

		expect(await blocker_states()).toStrictEqual([`${String(BLOCKER_NUMBER)}:CLOSED`])
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
	})
})

// joshuafolkken/kit#6754: the issue GET itself is the read the five commands `josh gh:usage` counts
// most calls for all make, so it is sent with the previous ETag as well.
describe('git_gh_issue_read — the issue GET through the ETag layer', () => {
	it('sends the issue GET through the ETag layer, not an unconditional gh api', async () => {
		const unconditional = vi.spyOn(git_gh_exec, 'exec_gh_api')

		serve({ kind: 'changed', etag: FIRST_ETAG, body: rest_issue() })

		expect(await git_gh_issue_read.issue_get_title(READ_NUMBER)).toBe(ISSUE_TITLE)
		expect(git_gh_conditional.read_conditional).toHaveBeenCalledWith(
			git_gh_api_path.issue_api_path(READ_NUMBER),
			undefined,
			undefined,
		)
		expect(unconditional).not.toHaveBeenCalled()
	})

	it('sends the previous ETag and answers the previous issue on a 304', async () => {
		serve({ kind: 'changed', etag: FIRST_ETAG, body: rest_issue() }, { kind: 'unchanged' })

		expect(await git_gh_issue_read.issue_get_title(READ_NUMBER)).toBe(ISSUE_TITLE)
		git_gh_issue_memo.forget()
		expect(await git_gh_issue_read.issue_get_title(READ_NUMBER)).toBe(ISSUE_TITLE)
		expect(sent_etags()).toStrictEqual([undefined, FIRST_ETAG])
	})

	it('answers undefined for an issue that cannot be read, as the unconditional read did', async () => {
		serve({ kind: 'unreadable', cause: new Error('HTTP 502') })

		expect(await git_gh_issue_read.issue_get_title(READ_NUMBER)).toBeUndefined()
	})
})
