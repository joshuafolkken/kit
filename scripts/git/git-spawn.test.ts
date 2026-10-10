import { GIT_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TIMEOUT_EXIT_CODE } from './git-execa-error'
import { git_spawn } from './git-spawn'

// joshuafolkken/kit#3590: the asynchronous `read` and `with_output` carried no timeout, unlike their
// synchronous counterpart, so a local git that never answered held an unattended run open for good.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

const REV_PARSE = ['rev-parse', 'HEAD']
const OVERRIDE_MS = 500
const QUOTE_PATH_OPTIONS = ['-c', 'core.quotePath=false']
const MERGE_SOURCE = 'origin/main'

async function to_failure(pending: Promise<unknown>): Promise<unknown> {
	try {
		return await pending
	} catch (error) {
		return error
	}
}

// The rejection is caught as it is created: the timer that settles it fires inside the advance,
// before a later `await` could attach a handler.
async function failure_after(pending: Promise<unknown>, budget_ms: number): Promise<unknown> {
	const caught = to_failure(pending)

	await vi.advanceTimersByTimeAsync(budget_ms)

	return await caught
}

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('git_spawn.read against a git that never answers', () => {
	it('fails once the local git budget is spent', async () => {
		const error = await failure_after(git_spawn.read(REV_PARSE), GIT_TIMEOUT_MS)

		expect(error).toMatchObject({ timedOut: true })
		expect(hanging_execa.timeouts()).toStrictEqual([GIT_TIMEOUT_MS])
	})

	it('takes the budget its caller names instead', async () => {
		const error = await failure_after(git_spawn.read(REV_PARSE, OVERRIDE_MS), OVERRIDE_MS)

		expect(error).toMatchObject({ timedOut: true })
		expect(hanging_execa.timeouts()).toStrictEqual([OVERRIDE_MS])
	})
})

describe('git_spawn.with_output against a git that never answers', () => {
	it('fails as a timeout once the local git budget is spent', async () => {
		const error = await failure_after(git_spawn.with_output('add', ['--', 'a']), GIT_TIMEOUT_MS)

		expect(error).toMatchObject({
			message: 'git add timed out after 10s',
			cause: { exit_code: TIMEOUT_EXIT_CODE },
		})
		expect(hanging_execa.timeouts()).toStrictEqual([GIT_TIMEOUT_MS])
	})

	it('takes the budget its caller names, with the config options ahead of the command', async () => {
		const pending = git_spawn.with_output('merge', [MERGE_SOURCE], {
			config_options: QUOTE_PATH_OPTIONS,
			timeout_ms: OVERRIDE_MS,
		})

		await failure_after(pending, OVERRIDE_MS)

		expect(hanging_execa.calls()[0]).toMatchObject({
			arguments_list: [...QUOTE_PATH_OPTIONS, 'merge', MERGE_SOURCE],
			options: { stdio: 'inherit', timeout: OVERRIDE_MS },
		})
	})
})
