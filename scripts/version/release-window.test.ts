import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { release_window } from './release-window'

const THREE_DAY_MINUTES = 4320
const ROOT_PREFIX = 'release-window-'

const make_directory = temporary_directory()

describe('release_window.parse_release_window', () => {
	it('reads the minutes and the exclusions together', () => {
		const workspace = 'minimumReleaseAge: 4320\nminimumReleaseAgeExclude:\n  - vite\n'

		expect(release_window.parse_release_window(workspace)).toStrictEqual({
			minutes: THREE_DAY_MINUTES,
			exclusions: ['vite'],
		})
	})

	it('keeps an explicit 0 opt-out apart from an undeclared window', () => {
		expect(release_window.parse_release_window('minimumReleaseAge: 0\n').minutes).toBe(0)
		expect(release_window.parse_release_window('packages: []\n').minutes).toBeUndefined()
	})

	it('refuses an exclusion list that is not a list of names', () => {
		expect(() => release_window.parse_release_window('minimumReleaseAgeExclude: vite\n')).toThrow()
	})
})

describe('release_window.read_release_window', () => {
	it('reads a missing workspace file as no window and no exclusions', () => {
		const root = make_directory(ROOT_PREFIX)

		expect(release_window.read_release_window(root)).toStrictEqual({
			minutes: undefined,
			exclusions: [],
		})
	})

	it('reads the workspace file at the root', () => {
		const root = make_directory(ROOT_PREFIX)

		writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 4320\n')
		expect(release_window.read_release_window(root).minutes).toBe(THREE_DAY_MINUTES)
	})
})
