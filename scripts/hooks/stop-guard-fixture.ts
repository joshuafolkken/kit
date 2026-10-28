import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { session_language } from '#scripts/josh/session-language'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_headless } from '#scripts/run/run-headless'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { vi } from 'vitest'

const UNREAD_TRANSCRIPT = 'transcript-not-read'

// `write_stop_decision`, handed in by the test: a source import of `stop-guard.ts` would pull its main
// guard into an import closure (`scripts/build/main-guard-boundary.test.ts`).
type StopDecision = (raw_payload: string) => Promise<void>

// A quiet world: no hold, no cut, no backlog — so the reply, and the prompt on `tail`, are all that
// is judged.
function quiet_world(tail = ''): void {
	vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
	vi.spyOn(run_stranded_detect, 'run_stranded_check').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
	vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)
	vi.spyOn(run_headless, 'must_keep_waiting').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_backlog_parent').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_headless').mockReturnValue(true)
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue(tail)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
}

// The stdout writes of one stop decision on `message`, in a session configured for `lang`.
async function decide_in(
	decide: StopDecision,
	lang: string,
	message: string,
	tail = '',
): Promise<Array<string>> {
	quiet_world(tail)
	process.env[session_language.ENV_KEY] = lang
	const written: Array<string> = []

	vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
		written.push(String(chunk))

		return true
	})
	const payload = JSON.stringify({
		transcript_path: UNREAD_TRANSCRIPT,
		last_assistant_message: message,
	})

	await decide(payload)

	return written
}

const stop_guard_fixture = { UNREAD_TRANSCRIPT, decide_in, quiet_world }

export { stop_guard_fixture }
