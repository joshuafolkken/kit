import path from 'node:path'
import { context_cut_payback } from '#scripts/cost-runtime/context-cut-payback'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_cli_fixture } from '#scripts/cost-runtime/cost-cli-fixture'
import { hook_context } from '#scripts/hooks/hook-context'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_decline } from '#scripts/run/cut/run-cut-decline'
import { run_cut_ready } from '#scripts/run/cut/run-cut-ready'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { implementation_cut } from './implementation-cut'
import { implementation_cut_verdict } from './implementation-cut-verdict'

const { CWD, priced_line, write_session_under } = cost_cli_fixture
const MODEL = 'claude-opus-5-5'
const LIMIT = context_cut_payback.break_even_context(MODEL)
const OLD_SESSION = 'before-resume'
const NEW_SESSION = 'after-resume'
const OLD_TRANSCRIPT = path.join(CWD, `${OLD_SESSION}.jsonl`)
const NEW_TRANSCRIPT = path.join(CWD, `${NEW_SESSION}.jsonl`)
const OPENAI_TRANSCRIPT = path.join(CWD, 'openai.jsonl')
const SOURCE = { JOSH_AGENT_PROVIDER: 'anthropic' }
const EDIT_CALL = { name: 'Edit', input: { file_path: 'scripts/x.ts' } }
const CALL_GIT = '/call/.git'
const CALL_CWD = path.join(CWD, 'call')

cost_cli_fixture.capture_console()

function clear_cache(): void {
	for (const transcript of [OLD_TRANSCRIPT, NEW_TRANSCRIPT, OPENAI_TRANSCRIPT]) {
		stamp_file.remove_stamp(implementation_cut_verdict.cache_path(transcript))
	}
}

beforeEach(clear_cache)

afterEach(() => {
	clear_cache()
	vi.useRealTimers()
	vi.unstubAllEnvs()
})

describe('implementation cut after resume', () => {
	it('ignores the previous over-threshold session and its cached verdict immediately after resume', () => {
		write_session_under(CWD, NEW_SESSION, [priced_line('new', MODEL, LIMIT)])
		write_session_under(CWD, OLD_SESSION, [priced_line('old', MODEL, LIMIT + 1)])
		expect(implementation_cut.session_verdict(OLD_TRANSCRIPT, CWD, SOURCE)).toBe('over')
		expect(implementation_cut.session_verdict(NEW_TRANSCRIPT, CWD, SOURCE)).toBe('under')
	})

	it('cuts again when the resumed session grows past the threshold', () => {
		vi.useFakeTimers()
		write_session_under(CWD, NEW_SESSION, [priced_line('first', MODEL, LIMIT)])
		expect(implementation_cut.session_verdict(NEW_TRANSCRIPT, CWD, SOURCE)).toBe('under')
		write_session_under(CWD, NEW_SESSION, [priced_line('grown', MODEL, LIMIT + 1)])
		vi.advanceTimersByTime(implementation_cut_verdict.VERDICT_REUSE_MS)
		expect(implementation_cut.session_verdict(NEW_TRANSCRIPT, CWD, SOURCE)).toBe('over')
	})
})

// A held, cuttable lane with no session id exported — the relaunched hook's environment.
function stub_cuttable_lane(): void {
	vi.stubEnv('CODEX_THREAD_ID', undefined)
	vi.stubEnv('CLAUDE_CODE_SESSION_ID', undefined)
	vi.spyOn(process, 'cwd').mockReturnValue(CWD)
	vi.spyOn(run_cut, 'held_issue_sync').mockReturnValue('6565')
	vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)
	vi.spyOn(run_cut_decline, 'is_declined_sync').mockReturnValue(false)
	vi.spyOn(run_cut_ready, 'is_ready_sync').mockReturnValue(true)
}

describe('implementation cut session identity', () => {
	it('preserves the OpenAI thread identity', () => {
		const source = { CODEX_THREAD_ID: 'resumed-thread' }
		const read = vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')

		implementation_cut.session_verdict(OPENAI_TRANSCRIPT, CWD, source)

		expect(read).toHaveBeenCalledWith(CWD, source)
	})

	it('preserves an exported Claude session id, as a unit pricing its parent has', () => {
		const source = { ...SOURCE, CLAUDE_CODE_SESSION_ID: OLD_SESSION }
		const read = vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')

		implementation_cut.session_verdict(NEW_TRANSCRIPT, CWD, source)

		expect(read).toHaveBeenCalledWith(CWD, source)
	})

	it('prices the hook transcript when deciding whether an edit needs a cut', () => {
		stub_cuttable_lane()
		const read = vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('over')
		const call = EDIT_CALL
		const run = {
			transcript: NEW_TRANSCRIPT,
			now_ms: implementation_cut.REISSUE_WINDOW_MS,
			context: hook_context.from_process(),
		}

		expect(implementation_cut.ROW.decide(call, run, true, 0)).toBe(true)
		expect(read).toHaveBeenCalledWith(
			CWD,
			expect.objectContaining({ CLAUDE_CODE_SESSION_ID: NEW_SESSION }),
		)
	})
})

describe('implementation cut candidate', () => {
	const call = EDIT_CALL

	it('takes a run edit as a candidate without pricing any session', () => {
		stub_cuttable_lane()
		const read = vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')

		expect(implementation_cut.ROW.is_trigger(call, hook_context.from_process())).toBe(true)
		expect(read).not.toHaveBeenCalled()
	})

	it("leaves an edit in a person's tree to the other rules", () => {
		stub_cuttable_lane()
		vi.spyOn(run_cut, 'held_issue_sync').mockReturnValue(undefined)

		expect(implementation_cut.ROW.is_trigger(call, hook_context.from_process())).toBe(false)
	})

	// joshuafolkken/kit#6973: the hold, the cut record and the decline record are the call's work tree's.
	it("reads the run hold, cut and decline records under the call context's cwd", () => {
		stub_cuttable_lane()
		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('over')
		const directory = vi.spyOn(run_cut, 'worktree_git_directory_sync').mockReturnValue(CALL_GIT)
		const run = {
			transcript: NEW_TRANSCRIPT,
			now_ms: implementation_cut.REISSUE_WINDOW_MS,
			context: hook_context_fixture.of(CALL_CWD, SOURCE),
		}

		expect(implementation_cut.ROW.decide(call, run, true, 0)).toBe(true)
		expect(directory).toHaveBeenCalledWith(CALL_CWD)
		expect(run_cut.held_issue_sync).toHaveBeenCalledWith(CALL_GIT)
		expect(run_cut.carried_cut_sync).toHaveBeenCalledWith(undefined, CALL_GIT)
		expect(run_cut_decline.is_declined_sync).toHaveBeenCalledWith('6565', CALL_GIT)
	})
})
