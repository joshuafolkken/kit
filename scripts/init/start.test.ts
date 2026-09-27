import { describe, expect, it } from 'vitest'
import type { ProjectShape } from './project-profile'
import { start } from './start'

const SHAPE: ProjectShape = {
	profile: 'static',
	reason: 'test',
	has_web: false,
	has_typescript: false,
	has_git: false,
	has_github: false,
}

describe('GitHub workflow entry', () => {
	it('explains that Git is optional for ordinary initialization', () => {
		expect(start.prerequisite(SHAPE)).toContain('use josh init')
	})

	it('requires a GitHub origin after local Git exists', () => {
		expect(start.prerequisite({ ...SHAPE, has_git: true })).toContain('GitHub origin')
	})

	it('accepts a GitHub project', () => {
		expect(start.prerequisite({ ...SHAPE, has_git: true, has_github: true })).toBeUndefined()
	})
})
