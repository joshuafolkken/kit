import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_utilities } from './constants'
import {
	git_ssh_keepalive,
	KEEPALIVE_SSH_COMMAND,
	SSH_COMMAND_VARIABLE,
	SSH_LEGACY_VARIABLE,
} from './git-ssh-keepalive'

// joshuafolkken/kit#3590: the `git config --get core.sshCommand` probe carried no timeout, and every
// remote call awaits it before its own budget starts — a probe that never answered was a wait the
// fetch's timeout (joshuafolkken/kit#2942) could not end.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
	vi.stubEnv(SSH_COMMAND_VARIABLE, '')
	vi.stubEnv(SSH_LEGACY_VARIABLE, '')
})

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllEnvs()
})

describe('git_ssh_keepalive.to_environment against a git config that never answers', () => {
	// "Cannot tell" is not "unset": the keepalive variable outranks `core.sshCommand`, so setting it on
	// a guess would replace a per-repository key with a plain `ssh`.
	it('leaves the ssh environment alone once the probe budget is spent', async () => {
		const pending = git_ssh_keepalive.to_environment()

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toStrictEqual({})
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})
})

describe('git_ssh_keepalive.to_environment against a git config that answers', () => {
	it('answers with the keepalive when the key is unset', async () => {
		hanging_execa.answer_with(git_utilities.get_git_command_for_spawn(), '')

		await expect(git_ssh_keepalive.to_environment()).resolves.toStrictEqual({
			[SSH_COMMAND_VARIABLE]: KEEPALIVE_SSH_COMMAND,
		})
	})
})
