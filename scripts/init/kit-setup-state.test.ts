import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { kit_setup_state } from './kit-setup-state'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const ROOT = '/work/game'
const KIT_MANIFEST = '{"devDependencies":{"@joshuafolkken/kit":"1.0.0"}}'
const mocked_execa = vi.mocked(execaSync)

function result(exit_code: number, stdout = ''): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout }

	return value as ReturnType<typeof execaSync>
}

beforeEach(() => {
	mocked_execa.mockReset()
})

describe('whether the checked-out commit holds kit (#2816)', () => {
	it('answers yes when the committed manifest lists kit', () => {
		mocked_execa.mockReturnValue(result(0, KIT_MANIFEST))

		expect(kit_setup_state.is_kit_committed(ROOT)).toBe(true)
	})

	it('answers no when the committed manifest does not list kit', () => {
		mocked_execa.mockReturnValue(result(0, '{"name":"game"}'))

		expect(kit_setup_state.is_kit_committed(ROOT)).toBe(false)
	})

	it('answers no when there is no committed manifest', () => {
		mocked_execa.mockReturnValue(result(1))

		expect(kit_setup_state.is_kit_committed(ROOT)).toBe(false)
	})
})

describe('the josh start hint josh init ends with (#2816)', () => {
	it('points at josh start in a Git repository whose commit does not hold kit', () => {
		mocked_execa.mockReturnValueOnce(result(0, 'true')).mockReturnValueOnce(result(0, '{}'))

		expect(kit_setup_state.start_hint(ROOT)).toContain('josh start')
	})

	it('stays silent once the commit holds kit', () => {
		mocked_execa.mockReturnValueOnce(result(0, 'true')).mockReturnValueOnce(result(0, KIT_MANIFEST))

		expect(kit_setup_state.start_hint(ROOT)).toBeUndefined()
	})

	it('stays silent outside a Git repository', () => {
		mocked_execa.mockReturnValue(result(1))

		expect(kit_setup_state.start_hint(ROOT)).toBeUndefined()
	})
})
