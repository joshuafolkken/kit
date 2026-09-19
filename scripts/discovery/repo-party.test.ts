import { describe, expect, it } from 'vitest'
import { repo_party } from './repo-party'

// The computed first-party/third-party test (joshuafolkken/kit#2122): owner equality, with an
// unreadable owner answered `unknown` rather than `third-party`.

describe('repo_party.classify', () => {
	it('is first-party when the owners match', () => {
		expect(repo_party.classify('joshuafolkken', 'joshuafolkken')).toBe(repo_party.FIRST_PARTY)
	})

	it('matches owners case-insensitively', () => {
		expect(repo_party.classify('JoshuaFolkken', 'joshuafolkken')).toBe(repo_party.FIRST_PARTY)
	})

	it('is third-party when the owners differ', () => {
		expect(repo_party.classify('joshuafolkken', 'sveltejs')).toBe(repo_party.THIRD_PARTY)
	})

	it.each([
		['the session owner is unreadable', undefined, 'sveltejs'],
		['the target owner is unreadable', 'joshuafolkken', undefined],
		['both are unreadable', undefined, undefined],
	])('is unknown when %s', (_name, session, target) => {
		expect(repo_party.classify(session, target)).toBe(repo_party.UNKNOWN)
	})
})

describe('repo_party.target_owner', () => {
	it.each([
		['owner/repo', 'sveltejs/kit', 'sveltejs'],
		['a .git suffix', 'sveltejs/kit.git', 'sveltejs'],
	])('reads the owner from %s', (_name, argument, owner) => {
		expect(repo_party.target_owner(argument)).toBe(owner)
	})

	it.each([
		['one segment', 'kit'],
		['three segments', 'a/b/c'],
	])('returns undefined for a malformed %s argument', (_name, argument) => {
		expect(repo_party.target_owner(argument)).toBeUndefined()
	})
})

describe('repo_party.current_owner', () => {
	// This suite runs in the kit checkout, whose `origin` owner is joshuafolkken — read from the
	// work tree's own config, so a lane and the primary checkout answer the same.
	it('reads the session repository owner from its origin', () => {
		expect(repo_party.current_owner()).toBe('joshuafolkken')
	})
})
