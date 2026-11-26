import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_demoted } from './hook-demoted'

// joshuafolkken/kit#6591: the demoted-rules file and the notice a demoted refusal turns into.

const make_directory = temporary_directory('test')
const DEMOTED = new Set(['batch'])
const BATCH = '⛔ batch: one call'
const PREFIX = 'hook-demoted-test-'

function file_in(directory: string): string {
	return path.join(directory, 'nested', 'hook-demoted.json')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('hook_demoted.read_rules / write_rules', () => {
	it('reads back the rules it wrote', async () => {
		const file = file_in(make_directory(PREFIX))

		await hook_demoted.write_rules(new Set(['scope', 'batch']), file)

		expect([...hook_demoted.read_rules(file)]).toStrictEqual(['batch', 'scope'])
	})

	it('reads a missing file as nothing demoted, without a trace', () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)
		const missing = file_in(make_directory(PREFIX))

		expect(hook_demoted.read_rules(missing).size).toBe(0)
		expect(trace).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#9043: a broken ledger silently undoes every demotion, so it leaves a trace.
	it.each(['{"rules": "batch"}', 'not json'])(
		'reads a malformed file (%s) as nothing demoted, and traces once',
		(body) => {
			const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)
			const malformed = path.join(make_directory(PREFIX), 'malformed.json')

			writeFileSync(malformed, body)

			expect(hook_demoted.read_rules(malformed).size).toBe(0)
			expect(trace).toHaveBeenCalledOnce()
			expect(trace).toHaveBeenCalledWith('hook_demoted.read_rules', expect.anything())
		},
	)

	it('reads an unreadable path as nothing demoted, and traces once', () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		expect(hook_demoted.read_rules(make_directory(PREFIX)).size).toBe(0)
		expect(trace).toHaveBeenCalledOnce()
	})

	it('demotes nothing under a test run, whatever the repository recorded', () => {
		expect(hook_demoted.rules().size).toBe(0)
	})
})

describe('hook_demoted.verdict / refusal_of', () => {
	it('heads a demoted notice with the call having run, and reads it back as its refusal', () => {
		const notice = hook_demoted.verdict([BATCH], DEMOTED)?.notice

		expect(notice).toContain('this call ran; do not reissue it')
		expect(hook_demoted.refusal_of(notice, DEMOTED)).toBe(BATCH)
	})

	it.each([
		[undefined],
		[`${hook_demoted.NOTICE_HEADER}⛔ scope: outside`],
		['ℹ batch: one call'],
		['a plain notice'],
	])('reads %j as no refusal', (notice) => {
		expect(hook_demoted.refusal_of(notice, DEMOTED)).toBeUndefined()
	})
})
