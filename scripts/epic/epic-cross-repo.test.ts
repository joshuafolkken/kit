import { propagate_publish } from '#scripts/propagate/propagate-publish'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_cross_repo } from './epic-cross-repo'
import type { EpicChild } from './epic-graph'

const KIT = 'joshuafolkken/kit'
const APP_KIT = 'joshuafolkken/app-kit'
const VERSION = '1.117.0'

function child(number: number, repo: string, state: 'OPEN' | 'CLOSED'): EpicChild {
	return { number, repo, state, labels: [], blocked_by: [] }
}

function never_read(): string | undefined {
	throw new Error('the registry must not be consulted here')
}

beforeEach(() => {
	vi.restoreAllMocks()
	// The registry answers are cached per repository for one pass; a stale entry would make the next
	// case read the previous one's answer.
	epic_cross_repo.reset_publish_cache()
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
