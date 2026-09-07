import { afterEach, describe, expect, it } from 'vitest'
import { git_location_environment, GIT_LOCATION_VARIABLES } from './git-location-environment'

// joshuafolkken/kit#1530. The list is what three consumers clear and one guard refuses on, so an
// entry silently dropped from it re-opens the defect in every one of them at once.

const SAMPLE = '/nowhere/.git'
const GIT_DIR = 'GIT_DIR'

// Held on an object so a case that changed the environment can be undone without a test assigning to
// a module-level binding.
const state: { restore: (() => void) | undefined } = { restore: undefined }

afterEach(() => {
	state.restore?.()
	state.restore = undefined
	Reflect.deleteProperty(process.env, GIT_DIR)
})

describe('GIT_LOCATION_VARIABLES', () => {
	// The two the hook environment actually carried when the fixture commits landed on a live branch.
	it('names the variables that redirected the write', () => {
		expect(GIT_LOCATION_VARIABLES).toContain(GIT_DIR)
		expect(GIT_LOCATION_VARIABLES).toContain('GIT_INDEX_FILE')
	})

	// `GIT_PREFIX` is exported to hooks too and redirects nothing, so the guard would refuse writes on
	// it for no reason. Its absence is a decision, not an omission.
	it('leaves out a hook variable that redirects nothing', () => {
		expect(GIT_LOCATION_VARIABLES).not.toContain('GIT_PREFIX')
	})
})

describe('git_location_environment.location_free_environment', () => {
	it('covers every name on the list', () => {
		const overlay = git_location_environment.location_free_environment()

		expect(Object.keys(overlay)).toStrictEqual([...GIT_LOCATION_VARIABLES])
	})

	// `undefined` and not `''`: execa removes the name for the first and sets an empty string for the
	// second, and git reads an empty `GIT_DIR` as a request rather than as an absence.
	it('answers undefined for each so the child loses them', () => {
		const overlay = git_location_environment.location_free_environment()
		const expected = GIT_LOCATION_VARIABLES.map(() => undefined)

		expect(Object.values(overlay)).toStrictEqual(expected)
	})
})

describe('git_location_environment.clear_git_location_variables', () => {
	it('removes the variables from this process', () => {
		process.env[GIT_DIR] = SAMPLE
		state.restore = git_location_environment.clear_git_location_variables()

		expect(process.env[GIT_DIR]).toBeUndefined()
	})

	// Restoring matters as much as clearing: a suite that left them cleared would hide the defect from
	// whatever ran next in the same worker rather than fixing it.
	it('puts back exactly what was there', () => {
		process.env[GIT_DIR] = SAMPLE
		git_location_environment.clear_git_location_variables()()

		expect(process.env[GIT_DIR]).toBe(SAMPLE)
	})

	it('leaves a name that was unset unset', () => {
		git_location_environment.clear_git_location_variables()()

		expect(Object.keys(process.env)).not.toContain(GIT_DIR)
	})
})
