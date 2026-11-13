import { performance } from 'node:perf_hooks'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { detached_launch } from '#scripts/run/detached-launch'
import { afterEach, expect, it, vi } from 'vitest'
import { lane_dispatch_dependency } from './lane-dispatch-dependency'

const REPO = 'joshuafolkken/kit'
const ISSUE = 7427
const BLOCKER = 7422

afterEach(() => vi.restoreAllMocks())

it.each([0, 1])(
	'measures a fixed local launch with %i blockers and target-only API reads',
	async (count) => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
		const read = vi
			.spyOn(git_gh_conditional, 'read_conditional')
			.mockImplementation(async (path) => {
				const blockers = count === 0 ? [] : [{ number: BLOCKER, state: 'closed' }]
				const number = Number(path.split('/').at(-1))
				const issue = { number, state: number === ISSUE ? 'open' : 'closed', body: '', labels: [] }
				const body = path.includes('/blocked_by') ? blockers : issue

				return { kind: 'changed', body: JSON.stringify(body), etag: undefined }
			})
		const started = performance.now()

		expect(await lane_dispatch_dependency.check(String(ISSUE))).toBeUndefined()
		const result = detached_launch.launch(
			{ argv: { command: process.execPath, args: ['--version'] }, cwd: process.cwd() },
			() => undefined,
		)
		const elapsed = performance.now() - started

		expect(result.kind).toBe('launched')
		expect(read).toHaveBeenCalledTimes(count + 2)
		console.info(
			`fixed launch: blockers=${String(count)} reads=${String(read.mock.calls.length)} elapsed_ms=${elapsed.toFixed(2)}`,
		)
	},
)
