import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_OBSERVATION_LEDGER_PATHS } from './observation-ledger'
import {
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
	observation_ledger_legacy,
} from './observation-ledger-legacy'

const make_directory = temporary_directory('suite')
const LINE = '- k:a | d1 | 2026-09-29 | x | y'

function root_with_file(relative: string): string {
	const root = make_directory('observation-ledger-legacy-test-')

	mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
	writeFileSync(path.join(root, relative), `${LINE}\n`)

	return root
}

function spy_warn(): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(console, 'warn').mockImplementation(() => undefined)
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#9049: nothing migrates an old ledger any more, so one left behind is named
// rather than silently ignored.
describe('observation_ledger_legacy.warn', () => {
	it.each(LEGACY_OBSERVATION_LEDGER_PATHS)('warns in one line about %s', (legacy) => {
		const warn = spy_warn()

		observation_ledger_legacy.warn(root_with_file(legacy))

		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain(legacy)
		expect(String(warn.mock.calls[0]?.[0])).not.toContain('\n')
	})

	it('warns about the old directory', () => {
		const warn = spy_warn()

		observation_ledger_legacy.warn(root_with_file(`${LEGACY_OBSERVATION_LEDGER_DIRECTORY}/1.md`))

		expect(warn).toHaveBeenCalledOnce()
		expect(warn.mock.calls[0]?.[0]).toContain(LEGACY_OBSERVATION_LEDGER_DIRECTORY)
	})

	it('names every old path found in the same one line', () => {
		const root = root_with_file(LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? '')

		writeFileSync(path.join(root, LEGACY_OBSERVATION_LEDGER_PATHS[1] ?? ''), `${LINE}\n`)

		expect(observation_ledger_legacy.found(root)).toEqual(LEGACY_OBSERVATION_LEDGER_PATHS)
	})

	it('says nothing when no old path exists', () => {
		const warn = spy_warn()

		observation_ledger_legacy.warn(make_directory('observation-ledger-legacy-empty-'))

		expect(warn).not.toHaveBeenCalled()
	})
})
