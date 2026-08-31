import { propagate_publish } from '#scripts/propagate/propagate-publish'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_cross_repo } from './epic-cross-repo'
import type { EpicChild } from './epic-graph'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const execa = await import('execa')
const gh = vi.mocked(execa.execaSync)

const KIT = 'joshuafolkken/kit'
const APP_KIT = 'joshuafolkken/app-kit'
const VERSION = '1.117.0'

function child(number: number, repo: string, state: 'OPEN' | 'CLOSED'): EpicChild {
	return { number, repo, state, labels: [], blocked_by: [] }
}

function never_read(): string | undefined {
	throw new Error('the registry must not be consulted here')
}

// The shape the manifest read asks `jq` for since joshuafolkken/kit#1129: the version and whether the
// package declares itself private, rather than the version alone.
const MANIFEST_READ_SUCCESS = {
	exitCode: 0,
	stdout: `{"version":"${VERSION}","private":null}`,
}
const MANIFEST_MISSING = { exitCode: 1, stdout: 'HTTP/2.0 404 Not Found' }
const MANIFEST_UNREADABLE = { exitCode: 1, stdout: 'HTTP/2.0 429 Too Many Requests' }
const READ_PLUS_PROBE = 2
const READ_FAILED = { exitCode: 1, stdout: '' }
const PRIVATE_MANIFEST = {
	exitCode: 0,
	stdout: `{"version":"${VERSION}","private":true,"workspaces":null}`,
}

// The `gh` results one read should see, in order: the manifest, then the probe the module makes only
// when the answer can still change.
function queue(...results: ReadonlyArray<{ exitCode: number; stdout: string }>): void {
	for (const result of results) {
		gh.mockReturnValueOnce(result as unknown as ReturnType<typeof execa.execaSync>)
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
	// The registry answers and the manifest reads are cached per repository for one pass; a stale
	// entry would make the next case read the previous one's answer.
	epic_cross_repo.reset_publish_cache()
	gh.mockReset()
	gh.mockReturnValue(MANIFEST_READ_SUCCESS as unknown as ReturnType<typeof execa.execaSync>)
})

describe('epic_cross_repo.package_name_for', () => {
	it('derives the scoped package a repository distributes', () => {
		expect(epic_cross_repo.package_name_for(KIT)).toBe('@joshuafolkken/kit')
	})

	it('refuses something that is not a repository', () => {
		expect(epic_cross_repo.package_name_for('not-a-repo')).toBeUndefined()
	})
})

describe('epic_cross_repo.is_same_owner_repo', () => {
	// Inherited from joshuafolkken/kit#869 rather than restated: a child in a repository this owner
	// does not own is not something to wait for or dispatch to.
	it('accepts a repository with the same owner', () => {
		expect(epic_cross_repo.is_same_owner_repo(APP_KIT, 'joshuafolkken')).toBe(true)
	})

	it('refuses a repository owned by anyone else', () => {
		expect(epic_cross_repo.is_same_owner_repo('another-org/thing', 'joshuafolkken')).toBe(false)
	})
})

// The evaluation is an AND and the order matters: while the blocker is open the registry is never
// consulted, so an epic never sits waiting on a publish from the moment it starts.
describe('epic_cross_repo.resolve_cross_repo — the order of the AND', () => {
	it('defers to the blocker while it is still open, without reading the registry', () => {
		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'OPEN'),
			child(2, APP_KIT, 'CLOSED'),
			never_read,
		)

		expect(verdict).toBe('inherit')
	})

	it('resolves a same-repository dependency on close alone, without reading the registry', () => {
		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, KIT, 'OPEN'),
			never_read,
		)

		expect(verdict).toBe('resolved')
	})
})

// Merging kit's issue does not publish kit — merge, auto-tag and publish run one after another — so
// a consumer told it may start at that moment installs the previous release, or nothing at all.
describe('epic_cross_repo.resolve_cross_repo — the publish condition', () => {
	it('waits when the blocker closed but its release has not appeared', () => {
		vi.spyOn(propagate_publish, 'fetch_published_versions').mockReturnValue(['1.116.0'])

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
			() => VERSION,
		)

		expect(verdict).toBe('time')
	})

	it('resolves once that exact version has appeared', () => {
		vi.spyOn(propagate_publish, 'fetch_published_versions').mockReturnValue(['1.116.0', VERSION])

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
			() => VERSION,
		)

		expect(verdict).toBe('resolved')
	})

	// A consumer several releases behind would otherwise be satisfied by any publish at all,
	// including one that predates the change it is waiting for.
})

describe('epic_cross_repo.resolve_cross_repo — what it will not accept', () => {
	it('is not satisfied by a newer release than the one it waits for', () => {
		vi.spyOn(propagate_publish, 'fetch_published_versions').mockReturnValue(['1.118.0'])

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
			() => VERSION,
		)

		expect(verdict).toBe('time')
	})

	it('waits when the registry could not be read', () => {
		vi.spyOn(propagate_publish, 'fetch_published_versions').mockReturnValue(undefined)

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
			() => VERSION,
		)

		expect(verdict).toBe('time')
	})
})

describe('epic_cross_repo.resolve_cross_repo — how often it asks', () => {
	// Several children commonly depend on the same blocker, and each edge would otherwise spawn its
	// own blocking `gh` call for an answer that cannot have changed in between.
	it('asks the registry once per repository, however many edges share the blocker', () => {
		const fetch_versions = vi
			.spyOn(propagate_publish, 'fetch_published_versions')
			.mockReturnValue([VERSION])
		const blocker = child(1, KIT, 'CLOSED')

		epic_cross_repo.resolve_cross_repo(blocker, child(2, APP_KIT, 'OPEN'), () => VERSION)
		epic_cross_repo.resolve_cross_repo(blocker, child(3, APP_KIT, 'OPEN'), () => VERSION)

		expect(fetch_versions).toHaveBeenCalledTimes(1)
	})

	// A polling run must see a release that appeared since its last round.
	it('asks again after the cache is reset', () => {
		const fetch_versions = vi
			.spyOn(propagate_publish, 'fetch_published_versions')
			.mockReturnValue([VERSION])
		const blocker = child(1, KIT, 'CLOSED')

		epic_cross_repo.resolve_cross_repo(blocker, child(2, APP_KIT, 'OPEN'), () => VERSION)
		epic_cross_repo.reset_publish_cache()
		epic_cross_repo.resolve_cross_repo(blocker, child(2, APP_KIT, 'OPEN'), () => VERSION)

		expect(fetch_versions).toHaveBeenCalledTimes(2)
	})
})

describe('epic_cross_repo.resolve_cross_repo — what it cannot determine', () => {
	// Not knowing what to wait for is not the same as having nothing to wait for.
	it('waits when the target version could not be read', () => {
		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
			() => undefined,
		)

		expect(verdict).toBe('time')
	})
})

// joshuafolkken/kit#1121 made a classification pass run once per withheld candidate rather than once,
// so an uncached manifest read is a blocking `gh` call multiplied by the size of the bundle.
describe('epic_cross_repo.read_default_branch_version', () => {
	it(`reads a repository's manifest once per pass`, () => {
		epic_cross_repo.read_default_branch_version(KIT)
		epic_cross_repo.read_default_branch_version(KIT)

		expect(gh).toHaveBeenCalledTimes(1)
	})

	// A polling run must see the version a merge in between has bumped.
	it('reads again after the cache is reset', () => {
		epic_cross_repo.read_default_branch_version(KIT)
		epic_cross_repo.reset_publish_cache()
		epic_cross_repo.read_default_branch_version(KIT)

		expect(gh).toHaveBeenCalledTimes(2)
	})

	// A failed read costs two calls — the read, then the status probe that says whether the manifest
	// is missing or the request failed — and then nothing for the rest of the pass.
	it('caches a read that failed rather than retrying it all pass', () => {
		gh.mockReturnValue(MANIFEST_UNREADABLE as unknown as ReturnType<typeof execa.execaSync>)

		expect(epic_cross_repo.read_default_branch_version(KIT)).toBeUndefined()
		expect(epic_cross_repo.read_default_branch_version(KIT)).toBeUndefined()
		expect(gh).toHaveBeenCalledTimes(READ_PLUS_PROBE)
	})
})

// joshuafolkken/kit#1129: joshuafolkken/kit#1126 made this branch reachable, and a closed blocker in a
// repository that ships no package then waited until the run's own timeout — there is no release for
// the publish check to ever find, and nothing an operator could edit to clear it.
describe('epic_cross_repo.publishes_nothing', () => {
	it('reads a repository with no manifest as shipping nothing', () => {
		gh.mockReturnValue(MANIFEST_MISSING as unknown as ReturnType<typeof execa.execaSync>)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(true)
	})

	// A private root is only conclusive once it is known not to be a workspace, so the manifest read is
	// followed by one read of `pnpm-workspace.yaml` (joshuafolkken/kit#1134).
	it('reads a private manifest with no workspace file as shipping nothing', () => {
		queue(PRIVATE_MANIFEST, READ_FAILED, MANIFEST_MISSING)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(true)
	})

	// `josh sync` distributes `pnpm-workspace.yaml` to every consumer whatever its layout — it carries
	// `overrides` and the like — so its presence proves nothing and only `packages:` does. Measured:
	// 20 of 20 private first-party checkouts have the file and none declares members.
	it('reads a workspace file that declares no members as shipping nothing', () => {
		queue(PRIVATE_MANIFEST, { exitCode: 0, stdout: 'overrides:\n  esbuild: 0.25.0\n' })

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(true)
	})

	// A layout nobody could read is not a repository that ships nothing.
	it('does not read an unreadable workspace file as shipping nothing', () => {
		queue(PRIVATE_MANIFEST, READ_FAILED, MANIFEST_UNREADABLE)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(false)
	})

	it('does not read a root declaring workspaces as shipping nothing', () => {
		queue({ exitCode: 0, stdout: `{"version":"${VERSION}","private":true,"workspaces":["pkg/*"]}` })

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(false)
	})

	// pnpm keeps its members in `pnpm-workspace.yaml` and leaves the manifest without the field, so the
	// file's presence is what says workspace there.
})

describe('epic_cross_repo.publishes_nothing — what it costs', () => {
	it('asks for the workspace file once per pass', () => {
		queue(PRIVATE_MANIFEST, { exitCode: 0, stdout: 'packages:\n  - packages/*\n' })

		epic_cross_repo.publishes_nothing(KIT)
		epic_cross_repo.publishes_nothing(KIT)

		expect(gh).toHaveBeenCalledTimes(READ_PLUS_PROBE)
	})

	// A public root publishes whatever its layout is, so the probe is never worth a request.
	it('asks for nothing further when the manifest is not private', () => {
		queue(MANIFEST_READ_SUCCESS)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(false)
		expect(gh).toHaveBeenCalledTimes(1)
	})

	it('reads a published manifest as shipping something', () => {
		gh.mockReturnValue(MANIFEST_READ_SUCCESS as unknown as ReturnType<typeof execa.execaSync>)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(false)
	})

	// The one direction this may not fail in: read as "nothing to wait for", a rate limit would start
	// work on a prerequisite that has not finished.
	it('does not read a failed request as shipping nothing', () => {
		gh.mockReturnValue(MANIFEST_UNREADABLE as unknown as ReturnType<typeof execa.execaSync>)

		expect(epic_cross_repo.publishes_nothing(KIT)).toBe(false)
	})
})

describe('epic_cross_repo.resolve_cross_repo — a repository that publishes nothing', () => {
	it('resolves a closed blocker rather than waiting for a release that cannot come', () => {
		gh.mockReturnValue(MANIFEST_MISSING as unknown as ReturnType<typeof execa.execaSync>)

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
		)

		expect(verdict).toBe('resolved')
	})

	it('keeps waiting when the manifest read failed rather than answering 404', () => {
		gh.mockReturnValue(MANIFEST_UNREADABLE as unknown as ReturnType<typeof execa.execaSync>)

		const verdict = epic_cross_repo.resolve_cross_repo(
			child(1, KIT, 'CLOSED'),
			child(2, APP_KIT, 'OPEN'),
		)

		expect(verdict).toBe('time')
	})
})
