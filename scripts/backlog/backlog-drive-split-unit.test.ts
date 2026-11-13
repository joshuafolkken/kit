import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import type { EpicSubject } from '#scripts/epic/epic-validate'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { EPIC_LABEL } from '#scripts/issue/issue-labels'
import { lane_implement_rate_read } from '#scripts/lane/lane-implement-rate-read'
import { run_carry } from '#scripts/run/carry/run-carry'
import type { AttachedLaunchResult, LaunchRequest } from '#scripts/run/detached-launch'
import { split_assess } from '#scripts/split/split-assess'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_split_unit, type SplitPorts } from './backlog-drive-split-unit'
import { backlog_drive_unit } from './backlog-drive-unit'

const ISSUE = '7182'
const GIT_DIRECTORY = '/repo/.git'
const RATE = { median: 3, lanes: 4 }
const OVER_LINES = 400
const WITHIN_LINES = 200
const COMPLETED: AttachedLaunchResult = { kind: 'completed', pid: 1, exit_code: 0 }

function body_of(lines: number): string {
	return `## 背景\n\n- 規模見積もり: 約 1 ファイル / ${String(lines)} 行（テスト除く）`
}

function subject_of(body: string, labels: ReadonlyArray<string> = [], state = 'OPEN'): EpicSubject {
	return { number: Number(ISSUE), state, labels, body }
}

const OVER = subject_of(body_of(OVER_LINES))
const REASONED = subject_of(`${body_of(OVER_LINES)}\n${split_assess.REASON_PREFIX} one deliverable`)

interface Fake {
	ports: SplitPorts
	requests: Array<LaunchRequest>
}

// `reads` answers the read before the unit, then the one after it, the last repeating.
function fake(reads: ReadonlyArray<EpicSubject | undefined>, is_repository = true): Fake {
	const requests: Array<LaunchRequest> = []
	const queue = [...reads]
	const ports: SplitPorts = {
		read: async () => (queue.length > 1 ? queue.shift() : queue[0]),
		measurements: async () => ({ implement_rate: RATE, growth: {} }),
		repository_directory: async () => (is_repository ? GIT_DIRECTORY : undefined),
		launch_attached: async (request) => {
			requests.push(request)

			return COMPLETED
		},
		environment: {},
		cwd: '/repo',
		now: () => 1,
	}

	return { ports, requests }
}

// The agent CLI is absent where CI runs, so its installed check is answered here.
beforeEach(() => {
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#7182: an issue over the size bar is judged for a split before any lane opens.
describe('backlog_drive_split_unit.run — over the size bar', () => {
	it('answers split once the unit made the issue an epic', async () => {
		const { ports, requests } = fake([OVER, subject_of(body_of(OVER_LINES), [EPIC_LABEL])])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('split')
		const argv = JSON.stringify(requests[0]?.argv)

		expect(requests).toHaveLength(1)
		expect(argv).toContain(`epic --promote ${ISSUE}`)
		expect(argv).not.toContain('run:split')
		expect(argv).toContain(`.josh/tmp/split-${ISSUE}-<k>.md`)
		expect(argv).toContain('issue:plan --planned --no-notify')
		expect(argv).toContain('issue:file --publish <E>')
		expect(requests[0]?.log_path).toContain(`-split-${ISSUE}-1.log`)
	})

	it('answers split once the unit closed the issue', async () => {
		const { ports } = fake([OVER, subject_of(body_of(OVER_LINES), [], 'CLOSED')])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('split')
	})

	it('answers launch when the unit recorded why it stays one', async () => {
		const { ports, requests } = fake([OVER, REASONED])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
		expect(requests).toHaveLength(1)
	})

	it('answers launch when the unit wrote neither, so the lane still opens', async () => {
		const { ports } = fake([OVER])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
	})

	it('answers launch without a unit outside a repository', async () => {
		const { ports, requests } = fake([OVER], false)

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
		expect(requests).toHaveLength(0)
	})
})

function raw_of(labels: ReadonlyArray<string>): string {
	const body = body_of(OVER_LINES)

	return JSON.stringify({
		number: Number(ISSUE),
		state: 'OPEN',
		labels: labels.map((name) => ({ name })),
		body,
	})
}

describe('backlog_drive_split_unit.run — production ports', () => {
	it('reads the issue from gh and launches the unit through the shared launcher', async () => {
		vi.spyOn(git_gh_command, 'issue_get_labels_and_body')
			.mockResolvedValueOnce(raw_of([]))
			.mockResolvedValueOnce(raw_of([EPIC_LABEL]))
		vi.spyOn(lane_implement_rate_read, 'measurements').mockResolvedValue({
			implement_rate: RATE,
			growth: {},
		})
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(GIT_DIRECTORY)
		const launch = vi.spyOn(backlog_drive_unit, 'launch_attached').mockResolvedValue(COMPLETED)

		await expect(backlog_drive_split_unit.run(ISSUE)).resolves.toBe('split')
		expect(git_gh_command.issue_get_labels_and_body).toHaveBeenCalledWith(ISSUE)
		expect(launch).toHaveBeenCalledOnce()
	})
})

describe('backlog_drive_split_unit.run — no unit is due', () => {
	it('runs no unit for an issue within the bar', async () => {
		const { ports, requests } = fake([subject_of(body_of(WITHIN_LINES))])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
		expect(requests).toHaveLength(0)
	})

	it('runs no unit once a reason it stays one is recorded', async () => {
		const { ports, requests } = fake([REASONED])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
		expect(requests).toHaveLength(0)
	})

	it('runs no unit for an issue it could not read', async () => {
		const { ports, requests } = fake([undefined])

		await expect(backlog_drive_split_unit.run(ISSUE, ports)).resolves.toBe('launch')
		expect(requests).toHaveLength(0)
	})
})
