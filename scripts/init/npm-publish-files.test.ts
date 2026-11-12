import { npm_registry } from '#scripts/version/npm-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROJECT_ROOT } from './init-paths'
import { npm_publish_files } from './npm-publish-files'
import type { ProjectShape } from './project-profile'

const PUBLISH_WORKFLOW = '.github/workflows/publish.yml'
const PACKAGE = '@joshuafolkken/app-kit'

const FULL_SHAPE: ProjectShape = {
	profile: 'full',
	reason: 'test',
	should_use_prettier: true,
	has_typescript: true,
	has_git: true,
	has_github: true,
	has_workflow: false,
}

function given_publishing(package_name: string | undefined): void {
	vi.spyOn(npm_registry, 'published_package_name').mockReturnValue(package_name)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('npm_publish_files.files', () => {
	it('distributes publish.yml to a repository npm carries', () => {
		given_publishing(PACKAGE)

		expect(npm_publish_files.files(FULL_SHAPE)).toEqual([PUBLISH_WORKFLOW])
		expect(npm_registry.published_package_name).toHaveBeenCalledWith(PROJECT_ROOT)
	})

	// The full `josh sync` passes no shape.
	it('distributes publish.yml when no shape is given and npm carries the package', () => {
		given_publishing(PACKAGE)

		expect(npm_publish_files.files()).toEqual([PUBLISH_WORKFLOW])
	})

	it('distributes nothing to a repository that does not publish to npm', () => {
		given_publishing(undefined)

		expect(npm_publish_files.files(FULL_SHAPE)).toEqual([])
	})

	it.each([
		['a basic project', { ...FULL_SHAPE, profile: 'basic' as const }],
		['a project without GitHub', { ...FULL_SHAPE, has_github: false }],
	])('never asks the registry for %s', (_label, shape) => {
		given_publishing(PACKAGE)

		expect(npm_publish_files.files(shape)).toEqual([])
		expect(npm_registry.published_package_name).not.toHaveBeenCalled()
	})

	it('names the workflow kit publishes from', () => {
		expect(npm_publish_files.PUBLISH_WORKFLOW).toBe(PUBLISH_WORKFLOW)
	})
})
