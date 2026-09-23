import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { hook_decision } from '#scripts/josh/hook-decision'
import { session_language } from '#scripts/josh/session-language'
import { stop_rules } from '#scripts/rules/stop-rules'
import { run_cut } from '#scripts/run/run-cut'
import { run_headless } from '#scripts/run/run-headless'
import { run_hold } from '#scripts/run/run-hold'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stop_guard, write_stop_decision } from './stop-guard'

const SWITCH_KEY = stop_rules.SWITCH_ENV_KEY
const LANG_KEY = session_language.ENV_KEY
const UNREAD_TRANSCRIPT = 'transcript-not-read'

afterEach(() => {
	Reflect.deleteProperty(process.env, SWITCH_KEY)
	Reflect.deleteProperty(process.env, LANG_KEY)
	vi.restoreAllMocks()
})

describe('stop_guard — fail open', () => {
	it('returns no outcome on a payload that is not JSON', async () => {
		expect(await stop_guard.outcome_of('not json')).toEqual(stop_rules.NO_OUTCOME)
	})

	it('returns no outcome when the guard switch is off, before any world read', async () => {
		process.env[SWITCH_KEY] = 'off'
		const payload = JSON.stringify({
			transcript_path: UNREAD_TRANSCRIPT,
			stop_hook_active: true,
		})

		expect(await stop_guard.stop_outcome_for_payload(payload, backlog_ready.DEFAULT_PORTS)).toEqual(
			stop_rules.NO_OUTCOME,
		)
	})
})

describe('write_stop_decision — the stall check is wired', () => {
	it('runs the stall detector on every stop', async () => {
		const check = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)

		await write_stop_decision('not json')

		expect(check).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#2472: two `backlog:next` reads per stop could outrun the hook's timeout.
	it('hands the stall detector the one reading the pick-up check reuses', async () => {
		const check = vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
		const shared = vi.spyOn(backlog_ready, 'shared_ports')

		await write_stop_decision('not json')

		expect(shared).toHaveBeenCalledOnce()
		expect(check).toHaveBeenCalledWith(shared.mock.results[0]?.value)
	})
})

// A quiet world: no hold, no cut, no backlog, no relay — so the reply is all that is judged.
function quiet_world(): void {
	vi.spyOn(backlog_stalled_detect, 'run_stall_check').mockResolvedValue(undefined)
	vi.spyOn(run_stranded_detect, 'run_stranded_check').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'worktree_directory').mockResolvedValue(undefined)
	vi.spyOn(run_hold, 'is_tree_dirty').mockResolvedValue(true)
	vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)
	vi.spyOn(run_headless, 'must_keep_waiting').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_backlog_parent').mockResolvedValue(false)
	vi.spyOn(run_headless, 'is_headless').mockReturnValue(true)
	vi.spyOn(time_density_hook, 'read_tail').mockReturnValue('')
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
}

// The stdout writes of one stop decision on `message`, in a session configured for `lang`.
async function decide_in(lang: string, message: string): Promise<Array<string>> {
	quiet_world()
	process.env[LANG_KEY] = lang
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	const payload = JSON.stringify({
		transcript_path: UNREAD_TRANSCRIPT,
		last_assistant_message: message,
	})

	await write_stop_decision(payload)

	return write.mock.calls.map((call) => String(call[0]))
}

// joshuafolkken/kit#2470: the configured language reaches both the check and the refusal's wording.
// `en` rather than the `ja` default, so a hard-coded default could not pass.
describe('write_stop_decision — the session language is wired', () => {
	beforeEach(() => {
		vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
	})

	it('sends back a Japanese reply in an en session, naming en', async () => {
		const written = await decide_in(
			'en',
			'ゲートは通過し、PR を作成しました。レビューで修正すべき指摘はありませんでした。',
		)

		expect(written.join('')).toContain('⛔ session language')
		expect(written.join('')).toContain('JOSH_SESSION_LANG: en')
	})

	it('lets an English reply in an en session stop', async () => {
		const written = await decide_in(
			'en',
			'The gate passed and the pull request is open; nothing is left to fix.',
		)

		expect(written).toEqual([])
	})
})
