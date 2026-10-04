import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hook_command_bootstrap } from './hook-command-bootstrap-fixture'

const UNKNOWN_GIT_OPTION = '--no-such-option'

describe('hook_command_bootstrap.initialize_repository', () => {
	let temporary_root = ''

	beforeEach(() => {
		temporary_root = mkdtempSync(path.join(tmpdir(), 'kit-hook-bootstrap-test-'))
	})

	afterEach(() => {
		rmSync(temporary_root, { recursive: true, force: true })
	})

	it('initializes a repository when git init succeeds', () => {
		expect(() => {
			hook_command_bootstrap.initialize_repository(
				['init', '-q'],
				temporary_root,
				hook_command_bootstrap.fresh_git_environment(),
			)
		}).not.toThrow()
	})

	it('throws naming the git command when git init fails', () => {
		expect(() => {
			hook_command_bootstrap.initialize_repository(
				['init', UNKNOWN_GIT_OPTION],
				temporary_root,
				hook_command_bootstrap.fresh_git_environment(),
			)
		}).toThrow(`git init ${UNKNOWN_GIT_OPTION} failed`)
	})
})

describe('hook_command_bootstrap.run_in_temporary_checkout', () => {
	it('runs the command inside a fresh git checkout', () => {
		const result = hook_command_bootstrap.run_in_temporary_checkout(
			'git rev-parse --is-inside-work-tree',
		)

		expect(result.status).toBe(0)
		expect(result.stdout.trim()).toBe('true')
	})
})
