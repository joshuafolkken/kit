import { describe, expect, it, vi } from 'vitest'
import { repo_party } from './repo-party'
import { repo_party_cli } from './repo-party-cli'

// `josh repo:party` — one word on stdout, the two owners it compared on stderr
// (joshuafolkken/kit#2122). The suite runs in the kit checkout, whose owner is joshuafolkken.

const SESSION_OWNER = repo_party.current_owner() ?? ''
const FIRST_PARTY = 'first-party'
const THIRD_PARTY = 'third-party'
const THIRD_PARTY_TARGET = 'sveltejs/kit'

describe('repo_party_cli.decide', () => {
	it('is first-party for a target under the session owner', () => {
		const decision = repo_party_cli.decide(`${SESSION_OWNER}/kit`)

		expect(decision.party).toBe(FIRST_PARTY)
		expect(decision.detail).toContain('session owner:')
		expect(decision.detail).toContain('target owner:')
	})

	it('is third-party for a different owner', () => {
		expect(repo_party_cli.decide(THIRD_PARTY_TARGET).party).toBe(THIRD_PARTY)
	})

	it('is unknown for a malformed target', () => {
		expect(repo_party_cli.decide('not-a-repo').party).toBe('unknown')
	})

	it('targets the session repository when no argument is given', () => {
		expect(repo_party_cli.decide(undefined).party).toBe(FIRST_PARTY)
	})
})

describe('repo_party_cli.run', () => {
	it('prints the verdict to stdout and the owners to stderr', () => {
		const out = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		const code = repo_party_cli.run([THIRD_PARTY_TARGET])

		expect(code).toBe(0)
		expect(out).toHaveBeenCalledWith(THIRD_PARTY)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('target owner: sveltejs'))
		out.mockRestore()
		error.mockRestore()
	})

	it('rejects more than one positional argument', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(repo_party_cli.run(['a/b', 'c/d'])).toBe(1)
		expect(error).toHaveBeenCalledWith(repo_party_cli.USAGE)
		error.mockRestore()
	})
})
