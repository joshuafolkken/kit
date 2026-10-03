import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { REPOSITORY_LABELS } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { repository_labels } from './repository-labels'

const mocked_api = vi.spyOn(git_gh_exec, 'exec_gh_api_sync')
const REPO = 'owner/app'
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALL_NAMES = REPOSITORY_LABELS.map((label) => label.name)

const NAME_SCHEMA = z.object({ name: z.string() })

function created_names(): ReadonlyArray<string> {
	return mocked_api.mock.calls.flatMap(([request]) =>
		request.body === undefined ? [] : [NAME_SCHEMA.parse(JSON.parse(request.body)).name],
	)
}

function fail(): never {
	throw new Error('gh: HTTP 403')
}

function list_then_create(existing: ReadonlyArray<string>, should_create = true): void {
	mocked_api.mockReturnValueOnce(existing.join('\n'))
	mocked_api.mockImplementation(() => (should_create ? '' : fail()))
}

beforeEach(() => {
	mocked_api.mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

describe('repository_labels.ensure_labels', () => {
	it('creates only the labels the repository is missing, matching names case-insensitively', () => {
		list_then_create(ALL_NAMES.slice(1).map((name) => name.toUpperCase()))

		expect(repository_labels.ensure_labels(REPO)).toStrictEqual([])
		expect(created_names()).toStrictEqual([ALL_NAMES[0]])
	})

	it('creates the release classification labels on a repository that only has enhancement', () => {
		list_then_create(['enhancement'])
		repository_labels.ensure_labels(REPO)

		expect(created_names()).toEqual(
			expect.arrayContaining(['breaking-change', 'bugfix', 'other-change', 'ignore-for-release']),
		)
		expect(created_names()).not.toContain('enhancement')
	})

	it('changes nothing on a repository that already has every label', () => {
		list_then_create(ALL_NAMES)

		expect(repository_labels.ensure_labels(REPO)).toStrictEqual([])
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	it('does not throw when a creation fails, and names the labels still missing', () => {
		list_then_create(ALL_NAMES.slice(2), false)

		expect(repository_labels.ensure_labels(REPO)).toStrictEqual(ALL_NAMES.slice(0, 2))
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(ALL_NAMES[0] ?? ''))
	})

	it('creates nothing and reports every label when the listing cannot be read', () => {
		mocked_api.mockImplementation(fail)

		expect(repository_labels.ensure_labels(REPO)).toStrictEqual(ALL_NAMES)
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	it('calls nothing and reports every label when the repository is unresolved', () => {
		expect(repository_labels.ensure_labels(undefined)).toStrictEqual(ALL_NAMES)
		expect(mocked_api).not.toHaveBeenCalled()
	})
})

// `josh start` provisions a new repository and `josh sync` every existing one; both go through the
// one module, and neither keeps a label creation of its own.
describe('the entry points that provision labels', () => {
	it.each(['init/start-steps.ts', 'sync/sync.ts'])('%s calls the shared label step', (file) => {
		const source = readFileSync(path.join(SCRIPTS_DIR, file), 'utf8')

		expect(source).toContain('repository_labels.ensure_labels(')
		expect(source).not.toMatch(/\/labels['`]/u)
	})
})
