import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import type { AttachedLaunchResult, LaunchRequest } from '#scripts/run/detached-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	backlog_drive_retrospective_unit,
	type UnitPorts,
} from './backlog-drive-retrospective-unit'

const GIT_DIRECTORY = '/repo/.git'
const CWD = '/repo'
const NOW = 1_700_000_000_000
const OWNER = '4242'
const FAILED_EXIT = 1

// The agent CLI is absent where CI runs, so its installed check is answered here.
beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

interface Fake {
	ports: UnitPorts
	emitted: Array<string>
	requests: Array<LaunchRequest>
}

interface Unit {
	result: AttachedLaunchResult
	is_marked: boolean
	is_repository?: boolean
}

function fake({ result, is_marked, is_repository = true }: Unit): Fake {
	const emitted: Array<string> = []
	const requests: Array<LaunchRequest> = []
	const ports: UnitPorts = {
		repository_directory: async () => (is_repository ? GIT_DIRECTORY : undefined),
		emit: async (text) => {
			emitted.push(text)
		},
		launch_attached: async (request) => {
			requests.push(request)

			return result
		},
		is_marked: (git_directory) => is_marked && git_directory === GIT_DIRECTORY,
		environment: {},
		cwd: CWD,
		now: () => NOW,
	}

	return { ports, emitted, requests }
}

function completed(exit_code: number): AttachedLaunchResult {
	return { kind: 'completed', pid: 1, exit_code }
}

describe('backlog_drive_retrospective_unit.run', () => {
	it('writes the retrospective stage, waits on one unit and answers true once the record is marked', async () => {
		const { ports, emitted, requests } = fake({ result: completed(0), is_marked: true })

		await expect(backlog_drive_retrospective_unit.run(OWNER, ports)).resolves.toBe(true)
		expect(emitted).toStrictEqual([run_event_setup.STAGE.RETROSPECTIVE])
		expect(requests).toHaveLength(1)
		expect(requests[0]?.cwd).toBe(CWD)
		expect(requests[0]?.log_path).toContain(`-retrospective-${String(NOW)}.log`)
	})

	// joshuafolkken/kit#6745: the record is the driver's owner's, so the unit's close must name it.
	it('briefs the unit with the digest command and a close under the record owner', async () => {
		const { ports, requests } = fake({ result: completed(0), is_marked: true })

		await backlog_drive_retrospective_unit.run(OWNER, ports)

		const argv = JSON.stringify(requests[0]?.argv)

		expect(argv).toContain('retrospective.md')
		expect(argv).toContain('pnpm josh retrospective')
		expect(argv).toContain(`run:carry --retrospective --summary`)
		expect(argv).toContain(`--owner ${OWNER}`)
	})

	it.each([
		['an exit 0 that left the record unmarked', completed(0)],
		['a non-zero exit', completed(FAILED_EXIT)],
		['a failed launch', { kind: 'failed', note: 'spawn failed' } as const],
	])('answers false on %s', async (_label, result) => {
		const { ports } = fake({ result, is_marked: false })

		await expect(backlog_drive_retrospective_unit.run(OWNER, ports)).resolves.toBe(false)
	})
})

describe('backlog_drive_retrospective_unit.run — no unit to start', () => {
	it('starts nothing outside a repository', async () => {
		const { ports, emitted, requests } = fake({
			result: completed(0),
			is_marked: true,
			is_repository: false,
		})

		await expect(backlog_drive_retrospective_unit.run(OWNER, ports)).resolves.toBe(false)
		expect(emitted).toHaveLength(0)
		expect(requests).toHaveLength(0)
	})

	it('starts nothing when no provider can be resolved', async () => {
		const { ports, emitted, requests } = fake({ result: completed(0), is_marked: true })
		const rejected = { ...ports, environment: { JOSH_AGENT_PROVIDER: 'unknown-provider' } }

		await expect(backlog_drive_retrospective_unit.run(OWNER, rejected)).resolves.toBe(false)
		expect(emitted).toHaveLength(0)
		expect(requests).toHaveLength(0)
	})
})
