import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_argv, type AgentArgvResult } from '#scripts/agent/agent-argv'
import { agent_diagnostics } from '#scripts/agent/agent-diagnostics'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { git_command } from '#scripts/git/git-command'
import { lane_dispatch_log } from '#scripts/lane/lane-dispatch-log'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { detached_launch } from '#scripts/run/detached-launch'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterAll, beforeEach, vi } from 'vitest'
import { run_cut } from './run-cut'

// What the `josh run:cut` CLI suites share: the scratch repository, the spied git and lane reads, and
// the per-test reset — so the setup-boundary suite runs on the same harness as the main suite rather
// than on a second copy of it.

const scratch = mkdtempSync(path.join(tmpdir(), 'run-cut-cli-test-'))
const REPOSITORY = path.join(scratch, 'repository.git')

const ISSUE = '1839'
const BRANCH = '1839-lane'
const INVOCATION = 'fullrun #1839'
const DEFAULT_BRANCH = 'main'
const LANE_DIRECTORY = '/lanes/1839'
const DERIVED_LOG = path.join(scratch, 'lane-1839.log')
const LAUNCHED_PID = 4242
// The context verdicts as `CostVerdict` values. The exported tokens widen to `string` through their namespace objects, so a typed literal is what the spied
// `session_verdict` return accepts.
const CONTEXT_OVER: CostVerdict = 'over'
const CONTEXT_UNDER: CostVerdict = 'under'
const CONTEXT_UNMEASURABLE: CostVerdict = 'unmeasurable'

function target(): string {
	return run_cut.cut_path(REPOSITORY)
}

function lane(): LaneInfo {
	return {
		issue: ISSUE,
		branch: BRANCH,
		directory: LANE_DIRECTORY,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: false,
	}
}

const state = vi.spyOn(run_cut, 'current_state')
const default_branch = vi.spyOn(git_command, 'get_default_branch')
const find_open_lane = vi.spyOn(lane_registry, 'find_open_lane')
const log_path = vi.spyOn(lane_dispatch_log, 'default_log_path')
const launch = vi.spyOn(detached_launch, 'launch')

// The pre-gate cut is conditional on the current context, so the suite pins the verdict rather than
// reading the live session. `over` is the beforeEach default, so a case cuts unless it says otherwise.
const session_verdict = vi.spyOn(cost_cli, 'session_verdict')
// The stream append a cut makes is spied so the suite writes no event to the real repository; what it
// pins is that the append is made, and with the cut kind, so `run:step` advances past the boundary.
const emit = vi.spyOn(run_event_stream_emit, 'emit')
const info = vi.spyOn(console, 'info').mockReturnValue()

function verdict(): string {
	return String(info.mock.calls.at(-1)?.[0])
}

// **The relaunch starts the child at the effort of the phase it resumes into**, so
// the expected profile is resolved for that phase — the default pre-gate cut lowers the worker to the
// ship/bookkeeping effort, which is the branch every relaunch case here takes.
function worker_argv(invocation: string): Extract<AgentArgvResult, { kind: 'argv' }> {
	const phase = run_cut.PRE_GATE_PHASE
	const built = agent_argv.resume_argv(invocation, undefined, phase, LANE_DIRECTORY)
	if (built.kind === 'rejected') throw new Error(built.note)

	return built
}

// The instruction a resume into implementation requires; carried on every declared cut here, harmless
// where a pre-gate cut resumes into the gate and does not read it.
const HANDOFF = { instruction: 'go', completed: [], remaining: [], untouched: [] }
// The same instruction as a `--handoff` file, which an implementation cut is refused without.
const HANDOFF_PATH = path.join(scratch, 'handoff.json')
const WITH_HANDOFF = ['--handoff', HANDOFF_PATH]

// A declared cut already on disk, as a fresh process would find one at its entry.
function existing_cut(phase: string = run_cut.PRE_GATE_PHASE): void {
	run_cut.begin_cut(target(), { issue: ISSUE, branch: BRANCH, phase, handoff: HANDOFF })
}

// Registers the suite's hooks and the spies no case reads, from each suite's top level. The scratch
// directory and the spies the cases read are created when this module is imported.
function install(): void {
	// The CLI version probe is the diagnostics' own test; here it would depend on the machine's CLI.
	vi.spyOn(agent_diagnostics, 'check').mockReturnValue({ kind: 'ready' })
	vi.spyOn(console, 'error').mockReturnValue()
	writeFileSync(HANDOFF_PATH, JSON.stringify(HANDOFF))

	beforeEach(() => {
		vi.clearAllMocks()
		run_cut.end_cut(target())
		vi.spyOn(run_cut, 'worktree_directory').mockResolvedValue(REPOSITORY)
		state.mockResolvedValue({ branch: BRANCH, is_dirty: true, is_held: true })
		default_branch.mockResolvedValue(DEFAULT_BRANCH)
		find_open_lane.mockResolvedValue(lane())
		log_path.mockReturnValue(DERIVED_LOG)
		launch.mockReturnValue({ kind: 'launched', pid: LAUNCHED_PID })
		session_verdict.mockReturnValue(CONTEXT_OVER)
		emit.mockResolvedValue(undefined)
	})

	afterAll(() => {
		vi.restoreAllMocks()
		rmSync(scratch, { force: true, recursive: true })
	})
}

const run_cut_cli_fixture = {
	install,
	ISSUE,
	BRANCH,
	INVOCATION,
	DEFAULT_BRANCH,
	LANE_DIRECTORY,
	DERIVED_LOG,
	CONTEXT_OVER,
	CONTEXT_UNDER,
	CONTEXT_UNMEASURABLE,
	target,
	lane,
	state,
	find_open_lane,
	launch,
	session_verdict,
	emit,
	verdict,
	worker_argv,
	WITH_HANDOFF,
	existing_cut,
}

export { run_cut_cli_fixture }
