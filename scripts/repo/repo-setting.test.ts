import { describe, expect, it, vi } from 'vitest'
import { repo_setting, type RepoSettingStatus } from './repo-setting'

const OK = 0
const NOT_FOUND = 1
const FIELD = 'allow_auto_merge'
const REPO = 'joshuafolkken/app-kit'

function classify(exit_code: number, stdout: string): RepoSettingStatus {
	return repo_setting.classify_boolean_setting(repo_setting.parse_payload(exit_code, stdout), FIELD)
}

// The rule both repository-setting reports are built on: an answer that could not be read is never
// reported as a negative answer. Every branch that cannot produce a trustworthy boolean has to land
// on `unreadable`, because reporting one as `disabled` sends a maintainer to change a setting that
// may already be correct (joshuafolkken/kit#805, joshuafolkken/kit#834).
describe('classify_boolean_setting', () => {
	it('reports a true field as enabled', () => {
		expect(classify(OK, `{"${FIELD}":true}`)).toBe('enabled')
	})

	it('reports a false field as disabled', () => {
		expect(classify(OK, `{"${FIELD}":false}`)).toBe('disabled')
	})

	it('never reports a failed call as disabled', () => {
		expect(classify(NOT_FOUND, '{"message":"Not Found"}')).toBe('unreadable')
	})

	it('never reports unparseable output as disabled', () => {
		expect(classify(OK, 'not json at all')).toBe('unreadable')
	})

	// A token without the right scope gets a response that simply omits the field. Absent is not
	// false: the setting may well be on.
	it('never reports a missing field as disabled', () => {
		expect(classify(OK, '{"name":"app-kit"}')).toBe('unreadable')
	})

	// A payload that is not the one this code was written against — guessing a boolean from it would
	// print an answer nothing supports.
	it('never reports a non-boolean field as an answer', () => {
		expect(classify(OK, `{"${FIELD}":"true"}`)).toBe('unreadable')
	})

	// `JSON.parse('null')` succeeds and yields an object-typed value; reading a field off it would
	// throw rather than classify.
	it('treats a null body as unreadable rather than crashing', () => {
		expect(classify(OK, 'null')).toBe('unreadable')
	})

	it('treats a non-object body as unreadable', () => {
		expect(classify(OK, '42')).toBe('unreadable')
	})
})

// The two fallbacks are deliberately different. One value is pasted into a shell and one is read as
// prose, so a single shared fallback would be wrong in one of the two places.
describe('repository fallbacks', () => {
	it('addresses a remediation command at the resolved repository', () => {
		expect(repo_setting.command_target(REPO)).toBe(REPO)
	})

	it('falls back to a placeholder in a command, never to prose', () => {
		expect(repo_setting.command_target(undefined)).toBe(repo_setting.REPO_PLACEHOLDER)
	})

	it('names the resolved repository in a status line', () => {
		expect(repo_setting.report_target(REPO)).toBe(REPO)
	})

	// `<owner>/<repo>` in a sentence reads as a broken template; prose is the honest rendering.
	it('falls back to prose in a status line, never to the placeholder', () => {
		expect(repo_setting.report_target(undefined)).toBe(repo_setting.UNKNOWN_REPOSITORY)
	})
})

describe('print_section', () => {
	it('separates the block with a blank line before the first reported line', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		repo_setting.print_section(['  ✔ first', '    second'])

		expect(info.mock.calls.flat()).toStrictEqual(['', '  ✔ first', '    second'])
		info.mockRestore()
	})
})
