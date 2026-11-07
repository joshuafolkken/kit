import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { git_gh_exec } from './git-gh-exec'
import { read_blocked_by } from './git-gh-issue-read'
import { git_gh_issue_rest } from './git-gh-issue-rest'
import {
	BLOCKER_NUMBER,
	ISSUE_NUMBER,
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

async function blocker_states(): Promise<Array<string>> {
	const blocked_by = await read_blocked_by(READ_NUMBER, BLOCKED_REST)

	return blocked_by.nodes.map((node) => `${String(node.number)}:${node.state}`)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
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
