import { beforeEach, describe, expect, it, vi } from 'vitest'
import { package_scout_cli } from './package-scout-cli'
import { package_scout_reuse } from './package-scout-reuse'

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const EXPLICIT_SIZE = 5
const DIRECTORY = '/lane/6510'
const UNDECIDED_NOTE = 'Reuse check: undecided'

function search_hit(name: string, score: number): object {
	return { package: { name, version: '1.0.0' }, score: { final: score } }
}

// The registry answers the search with the given pair; every per-package read fails, which leaves
// those metrics blank and the ranking on the search score alone.
function registry(first: number, second: number): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		await Promise.resolve()

		return String(input).includes('/-/v1/search')
			? Response.json({ objects: [search_hit('lead', first), search_hit('runner', second)] })
			: new Response(undefined, { status: 404 })
	})
}

function printed(): string {
	return vi
		.mocked(console.info)
		.mock.calls.map((call) => String(call[0]))
		.join('\n')
}

// The check itself is `package-scout-reuse.test.ts`'s; here it is a spy on the shared object.
beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(package_scout_reuse, 'check').mockResolvedValue({
		kind: 'undecided',
		note: UNDECIDED_NOTE,
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
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

	it('reads --issue as the reuse-check target and leaves it unset when absent', () => {
		expect(package_scout_cli.read_arguments(['date', '--issue', '6510'])).toEqual({
			keywords: 'date',
			size: package_scout_cli.DEFAULT_SIZE,
			issue: '6510',
		})
		expect(package_scout_cli.read_arguments(['date'])?.issue).toBeUndefined()
	})

	it.each([
		['an unknown flag', ['date', '--nope']],
		['no keywords', []],
		['a --size with no value', ['date', '--size']],
		['an --issue with no value', ['date', '--issue']],
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

	it('names the --issue flag in the usage it prints', () => {
		expect(package_scout_cli.USAGE).toContain('[--issue <n>]')
	})
})

// joshuafolkken/kit#6510: only a close pair reads the Issue, and a check that stopped fails the command.
describe('package_scout_cli.run — the reuse check on a close pair', () => {
	it('asks the reuse check on a close pair, naming the leader it would not add', async () => {
		registry(0.9, 0.88)

		expect(await package_scout_cli.run(['date', '--issue', '6510'], DIRECTORY)).toBe(
			SUCCESS_EXIT_CODE,
		)
		expect(package_scout_reuse.check).toHaveBeenCalledWith({
			issue: '6510',
			keywords: 'date',
			rejected: 'lead',
			directory: DIRECTORY,
		})
		expect(printed()).toContain(UNDECIDED_NOTE)
	})

	it('never reads the Issue on a clear pick', async () => {
		registry(0.9, 0.5)

		expect(await package_scout_cli.run(['date'], DIRECTORY)).toBe(SUCCESS_EXIT_CODE)
		expect(package_scout_reuse.check).not.toHaveBeenCalled()
		expect(printed()).toContain('Tier: clear')
	})

	it('exits 1 when the check stopped, so the ranking is not read as settled', async () => {
		registry(0.9, 0.88)
		vi.mocked(package_scout_reuse.check).mockResolvedValue({
			kind: 'record-failed',
			note: 'Reuse check: record failed',
		})

		expect(await package_scout_cli.run(['date'], DIRECTORY)).toBe(FAILURE_EXIT_CODE)
		expect(printed()).toContain('ask the user (Tier B)')
	})
})
