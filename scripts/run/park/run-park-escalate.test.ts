import { agent_worker_profile, type SettingsResult } from '#scripts/agent/agent-worker-profile'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { session_language } from '#scripts/josh/session-language'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_escalate } from './run-park-escalate'
import { run_stalled } from './run-stalled'
import { run_stalled_park } from './run-stalled-park'

// joshuafolkken/kit#7356: a worker declares that its Issue needs a stronger josh.worker profile.

const ISSUE = '7356'
const DIRECTORY = '/lane/7356'
const USAGE = 'Usage: josh run:park'
const REASON = 'Needs a cross-module redesign.'
const ARGV = [ISSUE, run_park_escalate.ESCALATE_FLAG, REASON]

function settings_with(escalate: boolean): SettingsResult {
	return { kind: 'settings', settings: { default: 'sonnet', escalate, profiles: [] } }
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(agent_worker_profile, 'read').mockReturnValue(settings_with(true))
	vi.spyOn(run_stalled_park, 'apply').mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_park_escalate.is_requested', () => {
	it.each([
		[[ISSUE, '--escalate', REASON], true],
		[[ISSUE, `--escalate=${REASON}`], true],
		[[ISSUE, '--clear'], false],
	])('reads %j as %s', (argv, expected) => {
		expect(run_park_escalate.is_requested(argv)).toBe(expected)
	})
})

describe('run_park_escalate.park', () => {
	it('parks the issue run:stalled with the reason recorded in the comment and the cause', async () => {
		await expect(run_park_escalate.park(ARGV, DIRECTORY, USAGE)).resolves.toBe(ISSUE)

		expect(agent_worker_profile.read).toHaveBeenCalledWith(DIRECTORY)
		expect(run_stalled_park.apply).toHaveBeenCalledWith(
			ISSUE,
			expect.stringContaining(`- Reason: ${REASON}`),
			`escalation requested: ${REASON}`,
		)
		expect(vi.mocked(run_stalled_park.apply).mock.calls[0]?.[1]).toContain(RUN_STALLED_LABEL)
	})

	it.each([
		['escalate false', settings_with(false)],
		['no josh.worker', { kind: 'unset' } as const],
	])('refuses the declaration with %s', async (_case, result) => {
		vi.mocked(agent_worker_profile.read).mockReturnValue(result)

		await expect(run_park_escalate.park(ARGV, DIRECTORY, USAGE)).resolves.toBeUndefined()
		expect(run_stalled_park.apply).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('josh.worker.escalate'))
	})

	it.each([
		['a blank reason', [ISSUE, run_park_escalate.ESCALATE_FLAG, '  ']],
		['no issue', [run_park_escalate.ESCALATE_FLAG, REASON]],
	])('prints the usage for %s', async (_case, argv) => {
		await expect(run_park_escalate.park(argv, DIRECTORY, USAGE)).resolves.toBeUndefined()
		expect(run_stalled_park.apply).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(USAGE)
	})

	it('answers undefined when the park could not be written', async () => {
		vi.mocked(run_stalled_park.apply).mockResolvedValue(false)

		await expect(run_park_escalate.park(ARGV, DIRECTORY, USAGE)).resolves.toBeUndefined()
	})
})

const JAPANESE_PROSE = 'より強い josh.worker プロファイル'

async function parked_with(lang: string): Promise<ReadonlyArray<unknown>> {
	vi.stubEnv(session_language.ENV_KEY, lang)
	await run_park_escalate.park(ARGV, DIRECTORY, USAGE)

	return vi.mocked(run_stalled_park.apply).mock.calls[0] ?? []
}

describe('run_park_escalate.park comment language', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each([
		['ja', JAPANESE_PROSE],
		['', JAPANESE_PROSE],
		['en', run_stalled.ESCALATION_REQUESTED.why],
	])('writes the prose in the %j session language', async (lang, prose) => {
		const [, comment] = await parked_with(lang)

		expect(comment).toContain(prose)
	})

	it.each(['ja', 'en'])('keeps the matched parts unchanged under %j', async (lang) => {
		const [issue, comment, cause] = await parked_with(lang)

		expect(issue).toBe(ISSUE)
		expect(comment).toContain(`\`${RUN_STALLED_LABEL}\``)
		expect(comment).toContain(`- Reason: ${REASON}`)
		expect(comment).toContain(`pnpm josh run:add ${ISSUE} --retry`)
		expect(cause).toBe(`escalation requested: ${REASON}`)
		expect(run_stalled.class_of(String(cause))).toBe(run_stalled.ESCALATION_REQUESTED.short)
	})
})
