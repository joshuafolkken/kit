import { describe, expect, it } from 'vitest'
import { run_merge_cli } from './run-merge-cli'

const CHILD = '2508'
const EPIC = '900'
const REPO = 'joshuafolkken/kit'

describe('run_merge_cli.parse — sanitizes subprocess-bound arguments', () => {
	it.each([
		[CHILD, '--epic', 'evil', '--repo', REPO],
		[CHILD, '--epic', EPIC, '--repo=--force'],
		[CHILD, '--epic', EPIC, '--repo=--evil/x'],
	])('refuses malformed subprocess arguments %j', (...argv) => {
		expect(run_merge_cli.parse(argv)).toBeUndefined()
	})

	it('accepts a well-formed epic and repository', () => {
		expect(run_merge_cli.parse([CHILD, '--epic', EPIC, '--repo', REPO])?.repo).toBe(REPO)
	})
})
