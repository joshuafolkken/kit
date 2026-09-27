import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { run_github_prerequisite } from './run-github-prerequisite'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
const mocked_execa = vi.mocked(execaSync)
const root = mkdtempSync(path.join(os.tmpdir(), 'josh-run-precondition-'))

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

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
})
