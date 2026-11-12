import { agent_worker_profile, type WorkerSettings } from '#scripts/agent/agent-worker-profile'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_worker } from './issue-file-worker'

const HERE = { target: 'owner/app', current: 'owner/app' }
const ELSEWHERE = { target: 'owner/other', current: 'owner/app' }
const AGENT = {
	provider: 'anthropic',
	role: 'worker',
	model: 'claude-sonnet-5-5',
	effort: 'medium',
} as const
const SETTINGS: WorkerSettings = {
	default: 'sonnet',
	escalate: false,
	profiles: [
		{ name: 'haiku', when: 'Mechanical work', agent: AGENT },
		{ name: 'sonnet', when: 'A brief', agent: AGENT },
	],
}
const BROKEN_NOTE = 'josh.worker default must name one of the profiles'
const HAIKU_LABEL = 'worker:haiku'
const OPUS_LABEL = 'worker:opus'
const ANY_LABEL = 'worker:anything'

const printed = {
	error: (): string => vi.mocked(console.error).mock.calls.join('\n'),
	info: (): string => vi.mocked(console.info).mock.calls.join('\n'),
	warn: (): string => vi.mocked(console.warn).mock.calls.join('\n'),
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	vi.spyOn(agent_worker_profile, 'read').mockReturnValue({ kind: 'settings', settings: SETTINGS })
})

describe('issue_file_worker.is_worker_clear — with josh.worker set', () => {
	it('prints each profile weakest first with its when, and the default for no label', () => {
		expect(issue_file_worker.is_worker_clear(HERE, ['enhancement'])).toBe(true)
		const guide = printed.info()

		expect(guide).toContain('none → sonnet')
		expect(guide.indexOf('worker:haiku — Mechanical work')).toBeLessThan(
			guide.indexOf('worker:sonnet — A brief'),
		)
	})

	it('admits a worker label naming a profile', () => {
		expect(issue_file_worker.is_worker_clear(HERE, [HAIKU_LABEL])).toBe(true)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('refuses a worker label naming no profile, with the reason', () => {
		expect(issue_file_worker.is_worker_clear(HERE, [OPUS_LABEL])).toBe(false)
		expect(printed.error()).toContain('has no profile for the label worker:opus')
	})

	it('refuses two worker labels', () => {
		expect(issue_file_worker.is_worker_clear(HERE, [HAIKU_LABEL, 'worker:sonnet'])).toBe(false)
		expect(printed.error()).toContain('allows one worker:<name> label')
	})
})

describe('issue_file_worker.is_worker_clear — a broken josh.worker', () => {
	beforeEach(() => {
		vi.mocked(agent_worker_profile.read).mockReturnValue({ kind: 'rejected', note: BROKEN_NOTE })
	})

	it('warns and admits a filing that chose no profile', () => {
		expect(issue_file_worker.is_worker_clear(HERE, [])).toBe(true)
		expect(printed.warn()).toContain(BROKEN_NOTE)
	})

	it('refuses a filing that chose a profile it cannot check', () => {
		expect(issue_file_worker.is_worker_clear(HERE, [HAIKU_LABEL])).toBe(false)
		expect(printed.error()).toContain(BROKEN_NOTE)
	})
})

describe('issue_file_worker — without josh.worker, or into another repository', () => {
	it('prints nothing and admits the filing when the setting is unset', () => {
		vi.mocked(agent_worker_profile.read).mockReturnValue({ kind: 'unset' })

		expect(issue_file_worker.is_worker_clear(HERE, [ANY_LABEL])).toBe(true)
		expect(issue_file_worker.label_definitions(HERE, [ANY_LABEL])).toStrictEqual([])
		expect(console.info).not.toHaveBeenCalled()
	})

	it('reads no setting for a filing into another repository', () => {
		expect(issue_file_worker.is_worker_clear(ELSEWHERE, [OPUS_LABEL])).toBe(true)
		expect(issue_file_worker.label_definitions(ELSEWHERE, [HAIKU_LABEL])).toStrictEqual([])
		expect(agent_worker_profile.read).not.toHaveBeenCalled()
	})
})

describe('issue_file_worker.label_definitions', () => {
	it('defines only the worker labels, for ensure_labels to create when missing', () => {
		const names = issue_file_worker
			.label_definitions(HERE, ['bugfix', HAIKU_LABEL])
			.map((label) => label.name)

		expect(names).toStrictEqual([HAIKU_LABEL])
	})
})
