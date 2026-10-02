import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { execa } from 'execa'

// A lane child whose own session has crossed the implementation-cut threshold, laid out on disk so the
// built `dist/hooks/pretool-guard.js` can be launched against it exactly as Claude Code launches it
// (joshuafolkken/kit#2922). Nothing is mocked: the dispatch mark is the environment, the lane is the
// path, and the verdict is priced from a session transcript under a throwaway `HOME`.

const LANE_ISSUE = '4242'
const SESSION_ID = '2922aaaa-0000-4000-8000-000000000000'
const OVER_THRESHOLD_INPUT_TOKENS = 300_000
const REQUEST_COUNT = 5
const HOOK_BUNDLE = path.resolve('dist/hooks/pretool-guard.js')

interface OverThresholdLane {
	root: string
	lane: string
	home: string
	transcript: string
}

function usage_line(index: number): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: `r${String(index)}`,
		message: { usage: { input_tokens: OVER_THRESHOLD_INPUT_TOKENS, output_tokens: 1 } },
	})
}

function write_session(home: string, lane: string): void {
	const directory = cost_transcript.transcript_directory(lane, home)
	const lines = Array.from({ length: REQUEST_COUNT }, (_, index) => usage_line(index))

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${SESSION_ID}.jsonl`), lines.join('\n'))
}

function create_over_threshold_lane(): OverThresholdLane {
	const created = mkdtempSync(path.join(tmpdir(), 'lane-cut-'))
	const root = realpathSync(created)
	const lane = path.join(root, '.kit-lanes', LANE_ISSUE)
	const home = path.join(root, 'home')
	const transcript = path.join(root, 'hook.jsonl')

	mkdirSync(lane, { recursive: true })
	writeFileSync(transcript, '')
	write_session(home, lane)

	return { root, lane, home, transcript }
}

function edit_payload(fixture: OverThresholdLane): string {
	const tool_input = {
		file_path: path.join(fixture.lane, 'a.ts'),
		old_string: 'a',
		new_string: 'b',
	}

	return JSON.stringify({ transcript_path: fixture.transcript, tool_name: 'Edit', tool_input })
}

// `extendEnv: false`, so a test run inside a real lane does not hand its own dispatch mark or session
// id to the hook and price this machine's transcript instead of the fixture's.
async function run_edit(fixture: OverThresholdLane): Promise<string> {
	const { stdout } = await execa('node', [HOOK_BUNDLE], {
		input: edit_payload(fixture),
		cwd: fixture.lane,
		extendEnv: false,
		env: {
			PATH: process.env['PATH'] ?? '',
			HOME: fixture.home,
			[agent_session_environment.SESSION_ID_KEY]: SESSION_ID,
			[lane_child_marker.KEY]: LANE_ISSUE,
			JOSH_WATCHER_GUARD: 'off',
		},
		reject: false,
	})

	return stdout
}

function remove(fixture: OverThresholdLane): void {
	rmSync(fixture.root, { recursive: true, force: true })
}

const lane_cut_fixture = { create_over_threshold_lane, remove, run_edit }

export type { OverThresholdLane }
export { lane_cut_fixture }
