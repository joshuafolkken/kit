import { token_shape_fixture } from '#scripts/lib/token-shape-fixture'
import { execa, execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'

// joshuafolkken/kit#4658: every Issue and pull-request body kit writes goes through `gh api`, so a
// body holding a credential is refused there, before gh is spawned.

vi.mock('execa', () => ({
	execa: vi.fn(),
	execaSync: vi.fn(),
}))

vi.mock('./git-gh-check', () => ({
	check_gh_installed: vi.fn(),
	GH_NOT_INSTALLED_MSG: 'gh CLI is not installed. Install it from https://cli.github.com/',
}))

const API_PATH = 'repos/o/r/issues/1/comments'
const SAMPLE = token_shape_fixture.sample_of('GitHub token')
const REFUSED_CASE = 'is refused before gh is spawned, $position'
const REFUSAL = `The gh api ${API_PATH} body holds a GitHub token-shaped string`

// The writers JSON-encode the body, so a token that starts a line, a nested field or a whole body sits
// right after an escape or a quote — the positions a scan of the encoded text would miss.
const LEAKING_BODIES = [
	{ position: 'after `=`', body: JSON.stringify({ body: `export GH_TOKEN=${SAMPLE}\n` }) },
	{
		position: 'at the start of a line',
		body: JSON.stringify({ body: `Ran it with\n${SAMPLE}\n` }),
	},
	{ position: 'after a tab', body: JSON.stringify({ body: `token:\t${SAMPLE}` }) },
	{ position: 'in a nested field', body: JSON.stringify({ input: { text: `\n${SAMPLE}` } }) },
	{ position: 'as a non-JSON body', body: `Ran it with\n${SAMPLE}\n` },
]

beforeEach(() => {
	vi.clearAllMocks()
})

describe('exec_gh_api — a body holding a credential', () => {
	it.each(LEAKING_BODIES)(REFUSED_CASE, async ({ body }) => {
		await expect(git_gh_exec.exec_gh_api({ path: API_PATH, body })).rejects.toThrow(REFUSAL)
		expect(vi.mocked(execa)).not.toHaveBeenCalled()
	})
})

describe('exec_gh_api_sync — a body holding a credential', () => {
	it.each(LEAKING_BODIES)(REFUSED_CASE, ({ body }) => {
		expect(() => git_gh_exec.exec_gh_api_sync({ path: API_PATH, body })).toThrow(REFUSAL)
		expect(vi.mocked(execaSync)).not.toHaveBeenCalled()
	})
})
