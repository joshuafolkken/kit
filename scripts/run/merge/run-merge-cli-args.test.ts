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

// joshuafolkken/kit#4102: the driver has no context to cut, so `--driver` carries no hand-off threshold.
describe('run_merge_cli.parse — --driver', () => {
	it('drops the hand-off threshold under --driver', () => {
		expect(run_merge_cli.parse([CHILD, '--driver'])?.over).toBeUndefined()
	})

	it('keeps the hand-off threshold without --driver', () => {
		expect(run_merge_cli.parse([CHILD])?.over).toBeDefined()
	})
})
