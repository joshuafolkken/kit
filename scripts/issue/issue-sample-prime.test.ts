import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { CURRENT_REPO_ISSUES, rest_issue } from '#scripts/gh/git-gh-issue-rest-fixture'
import { too_many_files_failure } from '#scripts/gh/git-gh-pr-fixture'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_sample_gate } from './issue-sample-gate'
import { issue_sample_prime, type PrimePorts } from './issue-sample-prime'

// joshuafolkken/kit#5241: a pull request GitHub refuses to serve as too many files changed is read
// through the issue endpoint, which carries its body and merge time. joshuafolkken/kit#7618: the pull
// request read goes through the ETag layer, so an unchanged one answers from the kept body.

const PR = 5222
const ISSUE = 5216
const MERGED_AT = '2026-10-27T09:00:00Z'
const ETAG = 'W/"pull"'
const SOURCE = { merged_at: MERGED_AT, closes: ISSUE }

function answer_with(...answers: Array<ConditionalRead>): void {
	const mocked = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const answer of answers) mocked.mockResolvedValueOnce(answer)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
})

describe('issue_sample_prime.read_source through the ETag layer', () => {
	it('answers an unchanged pull request from the previous body', async () => {
		const body = JSON.stringify({
			number: PR,
			body: `closes #${String(ISSUE)}`,
			merged_at: MERGED_AT,
		})

		answer_with({ kind: 'changed', etag: ETAG, body }, { kind: 'unchanged' })

		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(git_gh_conditional.read_conditional).toHaveBeenLastCalledWith(
			git_gh_api_path.pull_api_path(String(PR)),
			ETAG,
			undefined,
		)
	})
})

// joshuafolkken/kit#8057: the resident board judges a waiting issue on every redraw, so the ledger is
// read from its tail for the window after the cited merge, never whole.
const BEFORE = '2026-10-27T08:00:00Z'
const AFTER = '2026-10-27T10:00:00Z'
const GATED_BODY = `## 背景\n\n- 実施可能条件: #${String(PR)} のマージ後 3 マージ\n`
const make_directory = temporary_directory()

function ledger_line(kind: string, issue: number, at = AFTER): string {
	return `${JSON.stringify({ kind, at, issue })}\n`
}

function ledger_file(): string {
	const file = path.join(make_directory('sample-prime-'), 'ledger.jsonl')
	const lines = [ledger_line('merge', 1, BEFORE), ledger_line('merge', 2), ledger_line('pick', 3)]

	writeFileSync(file, lines.join(''), { mode: 0o600 })

	return file
}

async function prime_on(ledger: string): Promise<void> {
	await issue_sample_prime.prime([GATED_BODY], {
		pull: vi.fn<PrimePorts['pull']>().mockResolvedValue(SOURCE),
		closing: vi.fn<PrimePorts['closing']>(),
		ledger_path: vi.fn<PrimePorts['ledger_path']>().mockResolvedValue(ledger),
	})
}

function counted(): number | undefined {
	const wait = issue_sample_gate.wait_of(GATED_BODY)

	return wait?.kind === 'short' ? wait.counted : undefined
}

describe('issue_sample_prime.prime on the lane ledger', () => {
	afterEach(() => {
		issue_sample_gate.reset()
	})

	it('counts the merges after the cited merge without reading the whole ledger', async () => {
		const whole = vi.spyOn(lane_ledger, 'read_entries')

		await prime_on(ledger_file())

		expect(counted()).toBe(1)
		expect(whole).not.toHaveBeenCalled()
	})

	it('counts a merge appended after the prime', async () => {
		const ledger = ledger_file()

		await prime_on(ledger)
		expect(counted()).toBe(1)
		appendFileSync(ledger, ledger_line('merge', 4))

		expect(counted()).toBe(2)
	})

	it('reads the window once while the ledger is unchanged', async () => {
		const window = vi.spyOn(lane_ledger, 'read_since')

		await prime_on(ledger_file())
		counted()
		counted()

		expect(window).toHaveBeenCalledTimes(1)
		expect(window).toHaveBeenCalledWith(expect.any(String), Date.parse(MERGED_AT))
	})
})

describe('issue_sample_prime.read_source on a pull request too large to read', () => {
	it('reads the body and the merge time from the issue endpoint', async () => {
		const served = rest_issue({
			number: PR,
			body: `closes #${String(ISSUE)}`,
			pull_request: { merged_at: MERGED_AT },
		})

		answer_with({ kind: 'unreadable', cause: too_many_files_failure() })
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(served)

		expect(await issue_sample_prime.read_source(PR)).toStrictEqual(SOURCE)
		expect(exec).toHaveBeenCalledWith({ path: `${CURRENT_REPO_ISSUES}/${String(PR)}` })
	})

	it('rethrows any other failure of the pull request read', async () => {
		const failure = new Error('gh: HTTP 502')

		answer_with({ kind: 'unreadable', cause: failure })
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api')

		await expect(issue_sample_prime.read_source(PR)).rejects.toBe(failure)
		expect(exec).not.toHaveBeenCalled()
	})
})
