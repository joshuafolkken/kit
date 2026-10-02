import { beforeEach, describe, expect, it, vi } from 'vitest'
import { package_scout_cli } from './package-scout-cli'

const FAILURE_EXIT_CODE = 1
const EXPLICIT_SIZE = 5

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('package_scout_cli.read_arguments', () => {
	it('joins the positionals into the keywords and reads --size', () => {
		expect(package_scout_cli.read_arguments(['date', 'format', '--size', '5'])).toEqual({
			keywords: 'date format',
			size: EXPLICIT_SIZE,
		})
	})

	it('falls back to the default size when --size is absent', () => {
		expect(package_scout_cli.read_arguments(['date'])?.size).toBe(package_scout_cli.DEFAULT_SIZE)
	})

	it.each([
		['an unknown flag', ['date', '--nope']],
		['no keywords', []],
		['a --size with no value', ['date', '--size']],
	])('refuses %s', (_label, argv) => {
		expect(package_scout_cli.read_arguments(argv)).toBeUndefined()
	})
})

describe('package_scout_cli.run — refusals', () => {
	it('prints the usage and exits 1 on an unknown flag, before any registry read', async () => {
		const fetch_spy = vi.spyOn(globalThis, 'fetch')

		expect(await package_scout_cli.run(['date', '--nope'])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(package_scout_cli.USAGE)
		expect(fetch_spy).not.toHaveBeenCalled()
	})
})
