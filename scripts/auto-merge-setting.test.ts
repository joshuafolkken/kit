import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_merge_setting } from './auto-merge-setting'
import { gh_spawn } from './gh-spawn'
import { PROJECT_ROOT } from './init/init-paths'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const REPO = 'joshuafolkken/app-kit'
const OK = 0
const NOT_FOUND = 1
const ENABLED_BODY = '{"allow_auto_merge":true}'
const DISABLED_BODY = '{"allow_auto_merge":false}'

function fake_result(exit_code: number, stdout: string): ExecaSyncResult {
	const result = { exitCode: exit_code, stdout }

	return result as unknown as ExecaSyncResult
}

function stub_gh(exit_code: number, stdout: string): void {
	mocked_execa_sync.mockReturnValue(fake_result(exit_code, stdout))
}

beforeEach(() => {
	// resetAllMocks, not restore/clear: neither of those clears a `mockReturnValue` set on the
	// `vi.fn()` inside the `vi.mock('execa')` factory, so a stub would leak into the next test.
	vi.resetAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('read_auto_merge', () => {
	// The whole repository object, not a `--jq` projection: a projection cannot distinguish a field
	// that is `false` from a field the response never carried, and that distinction is the entire
	// point of the `unreadable` status.
	it('queries the repository object for the given repository', () => {
		stub_gh(OK, ENABLED_BODY)
		auto_merge_setting.read_auto_merge(REPO)

		expect(mocked_execa_sync).toHaveBeenCalledWith(
			'gh',
			['api', `repos/${REPO}`],
			expect.objectContaining({ reject: false }),
		)
	})

	it('never rejects on a failing gh call, so an unreadable setting cannot abort the caller', () => {
		stub_gh(NOT_FOUND, '')

		expect(auto_merge_setting.read_auto_merge(REPO)).toBe('unreadable')
	})

	it('returns disabled when the repository reports the setting off', () => {
		stub_gh(OK, DISABLED_BODY)

		expect(auto_merge_setting.read_auto_merge(REPO)).toBe('disabled')
	})

	// execa reports a spawn failure (no `gh` on PATH) as `exitCode: undefined` with `stdout`
	// undefined too, so neither may be dereferenced.
	it('does not crash when gh is missing entirely', () => {
		mocked_execa_sync.mockReturnValue({} as unknown as ExecaSyncResult)

		expect(auto_merge_setting.read_auto_merge(REPO)).toBe('unreadable')
	})

	it('bounds the request so a silently dropping proxy cannot hang the command', () => {
		stub_gh(OK, ENABLED_BODY)
		auto_merge_setting.read_auto_merge(REPO)

		expect(mocked_execa_sync).toHaveBeenCalledWith('gh', ['api', `repos/${REPO}`], {
			cwd: PROJECT_ROOT,
			reject: false,
			timeout: auto_merge_setting.GH_TIMEOUT_MS,
		})
	})
})

describe('report_auto_merge_section', () => {
	it('prints the enabled status for a resolvable repository', () => {
		stub_gh(OK, ENABLED_BODY)

		expect(auto_merge_setting.report_auto_merge_section(REPO)).toBe('enabled')
		expect(vi.mocked(console.info)).toHaveBeenCalled()
	})

	// `josh init` and `josh sync` already resolved the name for the Sonar config and pass it in, so
	// the report must not spawn a second `gh repo view` round trip.
	it('skips the repository lookup when the caller supplies the name', () => {
		const resolve = vi.spyOn(gh_spawn, 'get_repo_name_with_owner')

		stub_gh(OK, ENABLED_BODY)

		expect(auto_merge_setting.report_auto_merge_section(REPO)).toBe('enabled')
		expect(resolve).not.toHaveBeenCalled()
	})

	// The regression this signature exists to prevent: a default parameter would fire on an
	// explicitly-passed `undefined` and re-spawn `gh repo view` in the very path where the caller's
	// own lookup already failed.
	it('never spawns gh when the caller supplies an unresolved repository', () => {
		const resolve = vi.spyOn(gh_spawn, 'get_repo_name_with_owner')

		expect(auto_merge_setting.report_auto_merge_section(undefined)).toBe('unreadable')
		expect(resolve).not.toHaveBeenCalled()
		expect(mocked_execa_sync).not.toHaveBeenCalled()
	})

	it('prints the enabling command when the setting is off', () => {
		stub_gh(OK, DISABLED_BODY)
		auto_merge_setting.report_auto_merge_section(REPO)

		const printed = vi.mocked(console.info).mock.calls.flat().join('\n')

		expect(printed).toContain(`gh api -X PATCH repos/${REPO} -f allow_auto_merge=true`)
	})
})
