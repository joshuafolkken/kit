import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { git_gh_issue_write } from './git-gh-issue-write'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_api: vi.fn() },
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

// joshuafolkken/kit#3591: `label_ensure` read every failure as "the label already exists", so a
// refused credential, a rate limit and a dropped connection all left no trace.
const LABEL_NAME = 'epic'
const VALIDATION_FAILED = 'gh: Validation Failed (HTTP 422)'
const FORBIDDEN = 'gh: Forbidden (HTTP 403)'
const CONNECTION_FAILED = 'error connecting to api.github.com'
const FORBIDDEN_DOCUMENT = '{"message":"Forbidden","status":"403"}'
const warnings: Array<string> = []

// The 422 document GitHub answers a label write with; `code` is what tells an existing label from
// any other validation failure.
function validation_document(code: string): string {
	return JSON.stringify({
		message: 'Validation Failed',
		errors: [{ resource: 'Label', code, field: 'name' }],
		status: '422',
	})
}

// The error `exec_gh_api` throws: stderr's summary line, then the response body gh wrote to stdout,
// with the status classified from that body (`to_gh_error`).
function gh_error(summary: string, stdout: string): Error {
	const message = stdout.length > 0 ? `${summary}\n${stdout}` : summary

	return gh_failure.attach(new Error(message), gh_failure.classify_stdout(stdout))
}

async function ensure_label(): Promise<void> {
	await git_gh_issue_write.label_ensure({ name: LABEL_NAME, color: '5319e7', description: '' })
}

beforeEach(() => {
	vi.clearAllMocks()
	warnings.length = 0
	vi.spyOn(console, 'warn').mockImplementation((line: string) => {
		warnings.push(line)
	})
})

describe('label_ensure — which failure means the label is there', () => {
	// An existing label answers 422 `already_exists`, which is not an error here: the `|| true`
	// semantics the `gh label create` wrapper had.
	it('says nothing when the label already exists', async () => {
		mocked_api.mockRejectedValue(gh_error(VALIDATION_FAILED, validation_document('already_exists')))

		await expect(ensure_label()).resolves.toBeUndefined()
		expect(warnings).toStrictEqual([])
	})

	it.each([
		['a 422 for another reason', VALIDATION_FAILED, validation_document('invalid')],
		['a refused credential', FORBIDDEN, FORBIDDEN_DOCUMENT],
		['a request that never arrived', CONNECTION_FAILED, ''],
	])('warns about %s rather than reading it as an existing label', async (_name, summary, body) => {
		mocked_api.mockRejectedValue(gh_error(summary, body))

		await expect(ensure_label()).resolves.toBeUndefined()
		expect(warnings).toHaveLength(1)
		expect(warnings.join('\n')).toContain(`\`${LABEL_NAME}\``)
		expect(warnings.join('\n')).toContain(summary)
	})
})
