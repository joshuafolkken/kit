import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { home_tilde } from './home-tilde'

const USER_HOME = '/Users/account'
const ELSEWHERE = 'ls /work/kit'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('home_tilde.mask', () => {
	it('writes the home directory as ~', () => {
		vi.spyOn(os, 'homedir').mockReturnValue(USER_HOME)

		expect(home_tilde.mask(`cd ${USER_HOME}/Development/kit`)).toBe('cd ~/Development/kit')
	})

	it('masks every occurrence of the home directory', () => {
		vi.spyOn(os, 'homedir').mockReturnValue(USER_HOME)

		expect(home_tilde.mask(`cp ${USER_HOME}/a ${USER_HOME}/b`)).toBe('cp ~/a ~/b')
	})

	it('leaves a string without the home directory as is', () => {
		vi.spyOn(os, 'homedir').mockReturnValue(USER_HOME)

		expect(home_tilde.mask(ELSEWHERE)).toBe(ELSEWHERE)
	})

	it('leaves a sibling account whose name starts with the home name as is', () => {
		vi.spyOn(os, 'homedir').mockReturnValue(USER_HOME)

		expect(home_tilde.mask(`ls ${USER_HOME}s/a ${USER_HOME}`)).toBe(`ls ${USER_HOME}s/a ~`)
	})

	it.each(['/', ''])('leaves the string as is when the home directory is %j', (home) => {
		vi.spyOn(os, 'homedir').mockReturnValue(home)

		expect(home_tilde.mask(ELSEWHERE)).toBe(ELSEWHERE)
	})
})
