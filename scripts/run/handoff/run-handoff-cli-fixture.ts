import type { LaunchRequest } from '#scripts/run/detached-launch'
import { vi, type Mock } from 'vitest'
import type { HandoffPorts } from './run-handoff-cli'

// The ports a `run_handoff_cli.run` test starts from: a free tree in `/repo`, a child that launches and
// a final message naming a filed Issue; each test overrides the port it is about.

const ISSUE_URL = 'https://github.com/joshuafolkken/kit/issues/5400'
const FINAL = JSON.stringify({ type: 'result', result: `Filed ${ISSUE_URL}` })
const CLAUDE_SESSION = { CLAUDE_CODE_SESSION_ID: 'session', HOME: '/home' }
const PID = 42

interface Fake {
	ports: HandoffPorts
	lines: Array<string>
	requests: Array<LaunchRequest>
	directories: Array<string>
	backlogrun: Mock<HandoffPorts['backlogrun']>
}

type RecordingKey = 'make_directory' | 'launch' | 'launch_attached' | 'backlogrun' | 'write'

// The ports that record what the run did into the fake's arrays.
function recording_ports(record: Omit<Fake, 'ports'>): Pick<HandoffPorts, RecordingKey> {
	return {
		make_directory: (target) => {
			record.directories.push(target)
		},
		launch: (request) => {
			record.requests.push(request)

			return { kind: 'launched', pid: PID }
		},
		launch_attached: async (request) => {
			record.requests.push(request)

			return { kind: 'completed', pid: PID, exit_code: 0 }
		},
		backlogrun: record.backlogrun,
		write: (line) => {
			record.lines.push(line)
		},
	}
}

const QUIET_PORTS: Omit<HandoffPorts, RecordingKey> = {
	environment: CLAUDE_SESSION,
	cwd: '/repo',
	now: () => 1,
	repository_directory: async () => '/repo/.git',
	tree_hold: async () => ({ kind: 'free' }),
	lane_directory: async () => '/repo',
	read_text: () => FINAL,
	is_retrospective_done: () => true,
}

function fake(overrides: Partial<HandoffPorts> = {}): Fake {
	const record: Omit<Fake, 'ports'> = {
		lines: [],
		requests: [],
		directories: [],
		backlogrun: vi.fn<HandoffPorts['backlogrun']>(async () => 0),
	}
	const ports: HandoffPorts = { ...QUIET_PORTS, ...recording_ports(record), ...overrides }

	return { ports, ...record }
}

const run_handoff_cli_fixture = { fake, ISSUE_URL, CLAUDE_SESSION, PID }

export type { Fake }
export { run_handoff_cli_fixture }
