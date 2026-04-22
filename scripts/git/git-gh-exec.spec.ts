import { describe, expect, it } from 'vitest'
import { BODY_FILE_FLAG, BODY_FROM_STDIN, git_gh_exec } from './git-gh-exec'

describe('git_gh_exec', () => {
	it('exposes exec_gh_command as a callable function', () => {
		expect(typeof git_gh_exec.exec_gh_command).toBe('function')
	})

	it('exposes exec_gh_command_with_stdin as a callable function', () => {
		expect(typeof git_gh_exec.exec_gh_command_with_stdin).toBe('function')
	})
})

describe('BODY_FILE_FLAG', () => {
	it('is the --body-file flag string', () => {
		expect(BODY_FILE_FLAG).toBe('--body-file')
	})
})

describe('BODY_FROM_STDIN', () => {
	it('is the stdin marker string', () => {
		expect(BODY_FROM_STDIN).toBe('-')
	})
})
