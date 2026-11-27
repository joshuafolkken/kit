import { run_headless_keys } from '#scripts/run/run-headless-keys'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_file } from './issue-file'
import { HANDOFF_IMPLEMENTING_LABEL } from './issue-labels'

// joshuafolkken/kit#9143: a handed-off implementing run's filing carries the label that withholds auto-ok.

const FILED = ['Add a command that files an Issue', '--body-file', 'body.md']

describe('issue_file.parse — a handed-off implementing run', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('adds handoff:implementing to the labels', () => {
		vi.stubEnv(run_headless_keys.HANDOFF_CHILD_KEY, '1')
		vi.stubEnv(run_headless_keys.HANDOFF_LINE_KEY, 'fullrun new')

		expect(issue_file.parse(FILED)?.labels).toStrictEqual([HANDOFF_IMPLEMENTING_LABEL])
	})
})
