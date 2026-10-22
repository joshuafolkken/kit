import { readFileSync } from 'node:fs'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { check_event } = vi.hoisted(() => ({ check_event: vi.fn() }))

vi.mock('./pr-classification', () => ({ pr_classification: { check_event } }))

const ENTRY = 'scripts/ci/pr-classification-main.ts'
const EVENT_PATH = 'event.json'
const FAILURE_EXIT_CODE = 1

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	check_event.mockReset()
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('pr-classification-main', () => {
	it('is the script josh pr:classification runs', () => {
		expect(COMMAND_MAP['pr:classification']?.script).toBe(ENTRY)
	})

	it('leaves the module other files import without a main guard', () => {
		expect(readFileSync('scripts/ci/pr-classification.ts', 'utf8')).not.toContain('process.argv[1]')
	})

	it('checks the event GITHUB_EVENT_PATH names and passes a classified pull request', async () => {
		vi.stubEnv('GITHUB_EVENT_PATH', EVENT_PATH)
		check_event.mockReturnValue(undefined)

		expect(await main_entry_fixture.run_entry(ENTRY, [])).toBe(0)
		expect(check_event).toHaveBeenCalledWith(EVENT_PATH)
	})

	it('prints the classification error as a workflow annotation and fails', async () => {
		vi.stubEnv('GITHUB_EVENT_PATH', EVENT_PATH)
		check_event.mockReturnValue('no release classification')

		expect(await main_entry_fixture.run_entry(ENTRY, [])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith('::error::no release classification')
	})

	it('fails without GITHUB_EVENT_PATH and checks nothing', async () => {
		vi.stubEnv('GITHUB_EVENT_PATH', '')

		expect(await main_entry_fixture.run_entry(ENTRY, [])).toBe(FAILURE_EXIT_CODE)
		expect(check_event).not.toHaveBeenCalled()
	})
})
