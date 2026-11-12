import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execaSync } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { run_github_prerequisite } from './run-github-prerequisite'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)
const make_directory = temporary_directory('suite')
const root = make_directory('josh-run-precondition-')

describe('GitHub run prerequisites', () => {
	it('explains a missing Git repository without running git', () => {
		expect(run_github_prerequisite.explanation(root, 'run:entry')).toContain('requires Git')
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('explains a missing GitHub origin', () => {
		mkdirSync(path.join(root, '.git'))
		const result: unknown = { exitCode: 1, stdout: '' }

		mocked_execa.mockReturnValue(result as ReturnType<typeof execaSync>)
		expect(run_github_prerequisite.explanation(root, 'run:entry')).toContain('GitHub origin')
	})

	it('passes a GitHub origin', () => {
		const result: unknown = { exitCode: 0, stdout: 'git@github.com:owner/repo.git\n' }

		mocked_execa.mockReturnValue(result as ReturnType<typeof execaSync>)
		expect(run_github_prerequisite.explanation(root, 'run:entry')).toBeUndefined()
		expect(mocked_execa.mock.calls.at(-1)?.[1]).toStrictEqual([
			'config',
			'--get',
			'remote.origin.url',
		])
	})
})
