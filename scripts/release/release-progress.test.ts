import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { file_reader } from '#scripts/lib/read-file'
import { npm_registry } from '#scripts/version/npm-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { release_progress } from './release-progress'

const VERSION = '1.342.0'
const PACKAGE = '@joshuafolkken/kit'
const NPM_URL = 'https://www.npmjs.com/package/@joshuafolkken/kit/v/1.342.0'
const RELEASE_URL = 'https://github.com/joshuafolkken/kit/releases/tag/v1.342.0'
const COMPLETE_LINE = '🎉 Release v1.342.0 complete'
const SUCCESS = 0
const FAILURE = 1
const TAG = 'v1.342.0'
const RUN_ID = 39_108_200_869
const RUNS_PATH = '/actions/workflows/publish.yml/runs'
// The default npm wait, long enough that a test reaching its end would time out.
const DEFAULT_NPM_TIMEOUT_SECONDS = '1800'
const MISSED_NPM = '❌ Not published to npm'

function given_manifest(manifest: object): void {
	vi.spyOn(file_reader, 'read_optional').mockReturnValue(JSON.stringify(manifest))
}

function given_npm(is_published: boolean): void {
	vi.spyOn(npm_registry, 'has_public_version').mockReturnValue(is_published)
}

// `gh api` answers both the release (by its URL, 404 until it exists) and the Publish runs list.
function given_gh(release_url: string | undefined, runs: ReadonlyArray<object> = []): void {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async ({ path }) => {
		if (path.includes(RUNS_PATH)) return JSON.stringify({ workflow_runs: runs })
		if (release_url === undefined) throw new Error('HTTP 404')

		return release_url
	})
}

function given_release(url: string | undefined): void {
	given_gh(url)
}

// A run still at work has no conclusion yet.
function publish_run(status: string, conclusion?: string): object {
	return { id: RUN_ID, display_title: `Publish ${TAG}`, status, conclusion }
}

function release_reads(): number {
	return vi
		.mocked(git_gh_exec.exec_gh_api)
		.mock.calls.filter(([request]) => !request.path.includes(RUNS_PATH)).length
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

beforeEach(() => {
	vi.clearAllMocks()
	// One attempt per stage, so a stage that is not reached costs no wall clock.
	vi.stubEnv(release_progress.NPM_TIMEOUT_ENV, '1')
	vi.stubEnv(release_progress.GITHUB_RELEASE_TIMEOUT_ENV, '1')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	given_manifest({ name: PACKAGE, version: VERSION })
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('release_progress stage lines', () => {
	it('links the pull request when it is opened and when it merges', () => {
		const url = 'https://github.com/joshuafolkken/kit/pull/7'

		expect(release_progress.pr_opened_line(url)).toBe(`📝 Release PR opened: ${url}`)
		expect(release_progress.pr_merged_line(url)).toBe(`🔀 Release PR merged: ${url}`)
	})

	it('links the npm page of the released version', () => {
		expect(release_progress.npm_package_url(PACKAGE, VERSION)).toBe(NPM_URL)
	})

	it('addresses the release REST answers 404 for until it exists', () => {
		expect(git_gh_api_path.release_by_tag_api_path('v1.342.0')).toBe(
			'repos/{owner}/{repo}/releases/tags/v1.342.0',
		)
	})
})

describe('release_progress.wait_for_distribution', () => {
	it('prints each stage with its link and then the completion line', async () => {
		given_npm(true)
		given_release(RELEASE_URL)

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(SUCCESS)
		expect(printed()).toBe(
			[
				`📦 Published to npm: ${NPM_URL}`,
				`📰 GitHub Release created: ${RELEASE_URL}`,
				COMPLETE_LINE,
			].join('\n'),
		)
	})
})

describe('release_progress.wait_for_distribution when a stage is not reached', () => {
	it('names npm as not reached and stops before the release watch when npm times out', async () => {
		given_npm(false)
		given_release(RELEASE_URL)

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(FAILURE)
		expect(printed()).toContain(MISSED_NPM)
		expect(printed()).not.toContain('🎉')
		expect(release_reads()).toBe(0)
	})

	it('names the GitHub Release as not reached when it times out', async () => {
		given_npm(true)
		given_release(undefined)

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(FAILURE)
		expect(printed()).toContain('📦 Published to npm')
		expect(printed()).toContain('❌ No GitHub Release: v1.342.0')
		expect(printed()).not.toContain('🎉')
	})

	it('skips the npm stage for a private package', async () => {
		given_manifest({ name: 'consumer-app', private: true })
		given_npm(false)
		given_release(RELEASE_URL)

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(SUCCESS)
		expect(npm_registry.has_public_version).not.toHaveBeenCalled()
		expect(printed()).not.toContain('npm')
		expect(printed()).toContain(COMPLETE_LINE)
	})
})

describe('release_progress.wait_for_distribution when the Publish run fails', () => {
	// Before the fix the npm wait polled only the registry and ran out its full timeout here.
	it('stops on the first read and names the failed run instead of waiting out the timeout', async () => {
		vi.stubEnv(release_progress.NPM_TIMEOUT_ENV, DEFAULT_NPM_TIMEOUT_SECONDS)
		given_npm(false)
		given_gh(RELEASE_URL, [publish_run('completed', 'failure')])

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(FAILURE)
		expect(npm_registry.has_public_version).toHaveBeenCalledTimes(1)
		expect(printed()).toContain(`❌ Publish ${TAG} failed (run ${String(RUN_ID)})`)
		expect(printed()).toContain(`gh run view ${String(RUN_ID)}`)
		expect(release_reads()).toBe(0)
	})

	it.each([
		['not listed yet', []],
		['still running', [publish_run('in_progress')]],
		['succeeded ahead of the registry', [publish_run('completed', 'success')]],
	])('keeps waiting for npm while the run is %s', async (_state, runs) => {
		given_npm(false)
		given_gh(RELEASE_URL, runs)

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(FAILURE)
		expect(printed()).toContain(MISSED_NPM)
		expect(printed()).not.toContain('failed (run')
	})

	it('keeps waiting for npm when the runs cannot be read', async () => {
		given_npm(false)
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('HTTP 404'))

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(FAILURE)
		expect(printed()).toContain(MISSED_NPM)
	})

	it('reaches the completion line when npm has the version even beside a failed run', async () => {
		given_npm(true)
		given_gh(RELEASE_URL, [publish_run('completed', 'failure')])

		expect(await release_progress.wait_for_distribution(VERSION)).toBe(SUCCESS)
		expect(printed()).toContain(COMPLETE_LINE)
	})
})

describe('release_progress.read_manifest', () => {
	it('refuses a manifest without a package name', () => {
		given_manifest({ version: VERSION })

		expect(() => release_progress.read_manifest('/repo')).toThrow('has no package name')
	})

	// The basic profile's `josh init` writes `{ "private": true }` with no name.
	it('accepts a private manifest without a package name', () => {
		given_manifest({ private: true, version: VERSION })

		expect(release_progress.read_manifest('/repo')).toEqual({ is_private: true })
	})
})
