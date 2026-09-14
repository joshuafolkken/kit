import { describe, expect, it } from 'vitest'
import { auto_merge_setting_logic, type AutoMergeStatus } from './auto-merge-setting-logic'
import { repo_setting } from './repo-setting'

const OK = 0
const NOT_FOUND = 1
const REPO = 'joshuafolkken/app-kit'
const ENABLED_BODY = '{"allow_auto_merge":true}'
const DISABLED_BODY = '{"allow_auto_merge":false}'
const NO_SCOPE_BODY = '{"name":"app-kit","full_name":"joshuafolkken/app-kit"}'
const NOT_FOUND_BODY = '{"message":"Not Found","status":"404"}'
const NO_ADMIN_ACCESS_TEXT = 'No admin access'
const SETTINGS_PAGE_TEXT = 'Allow auto-merge'
const ENABLE_COMMAND_PREFIX = 'gh api -X PATCH'

function classify(exit_code: number, stdout: string): AutoMergeStatus {
	return auto_merge_setting_logic.classify_auto_merge(exit_code, stdout)
}

// `repo` is required, never defaulted: a default parameter fires on an explicitly-passed
// `undefined`, so the unresolved-repository cases would silently run against a resolved one — the
// same trap the reporting functions themselves are written to avoid.
function report(status: AutoMergeStatus, repo: string | undefined): string {
	return auto_merge_setting_logic.format_auto_merge_report(status, repo).join('\n')
}

function report_for_repo(status: AutoMergeStatus): string {
	return report(status, REPO)
}

describe('classify_auto_merge', () => {
	it('reports the setting on as enabled', () => {
		expect(classify(OK, ENABLED_BODY)).toBe('enabled')
	})

	it('reports the setting off as disabled', () => {
		expect(classify(OK, DISABLED_BODY)).toBe('disabled')
	})

	// The distinction the report exists for: a 404 on a repository the token cannot administer must
	// not be reported as "auto-merge is off", or the maintainer is sent to change a setting that may
	// already be correct.
	it('never reports a failed lookup as disabled', () => {
		expect(classify(NOT_FOUND, NOT_FOUND_BODY)).toBe('unreadable')
	})

	// `allow_auto_merge` is simply absent from the response a token without the right scope receives.
	it('never reports a response that omits the field as disabled', () => {
		expect(classify(OK, NO_SCOPE_BODY)).toBe('unreadable')
	})
})

describe('format_auto_merge_report — enabled', () => {
	it('reports a single line naming the resolved repository', () => {
		expect(auto_merge_setting_logic.format_auto_merge_report('enabled', REPO)).toStrictEqual([
			`  ✔ ${auto_merge_setting_logic.SETTING_LABEL}: enabled (${REPO})`,
		])
	})

	// Nothing to fix, so nothing to paste — a command printed here would read as an instruction.
	it('prints no enabling command when the setting is already on', () => {
		expect(report_for_repo('enabled')).not.toContain(ENABLE_COMMAND_PREFIX)
	})
})

describe('format_auto_merge_report — disabled', () => {
	it('names the consequence: the workflow fails and the pull requests stay open', () => {
		expect(report_for_repo('disabled')).toContain('Auto-merge is not allowed for this repository')
	})

	// A literal `<owner>/<repo>` would be unusable when pasted into a shell, where `<` redirects.
	it('addresses the enabling command at the resolved repository', () => {
		expect(report_for_repo('disabled')).toContain(
			`gh api -X PATCH repos/${REPO} -f allow_auto_merge=true`,
		)
	})

	it('falls back to a placeholder when the repository could not be resolved', () => {
		expect(report('disabled', undefined)).toContain(
			`repos/${repo_setting.REPO_PLACEHOLDER} -f allow_auto_merge=true`,
		)
	})

	// kit reports the setting and never changes it — a repository setting is outward-facing and needs
	// admin scope, which is why `josh doctor --fix` does not enable it either.
	it('states that kit never changes the repository setting itself', () => {
		expect(report_for_repo('disabled')).toContain('kit never changes a repository setting')
	})
})

describe('format_auto_merge_report — unreadable', () => {
	it('reports the setting as unchecked rather than as off', () => {
		const printed = report_for_repo('unreadable')

		expect(printed).toContain('could not be read')
		expect(printed).toContain('not necessarily off')
	})

	// The remediation would be wrong whenever the setting is actually on and merely unreadable.
	it('prints no enabling command when the answer is unknown', () => {
		expect(report_for_repo('unreadable')).not.toContain(ENABLE_COMMAND_PREFIX)
	})

	it('lists the possible causes for an identified repository', () => {
		const printed = report_for_repo('unreadable')

		expect(printed).toContain(NO_ADMIN_ACCESS_TEXT)
		expect(printed).toContain(SETTINGS_PAGE_TEXT)
	})

	// Admin access and a settings page are beside the point when no repository was identified at all,
	// and naming a page the reader cannot open is worse than saying nothing.
	it('explains the missing repository instead when none was resolved', () => {
		const printed = report('unreadable', undefined)

		expect(printed).toContain(repo_setting.UNKNOWN_REPOSITORY)
		expect(printed).toContain('could not be identified')
		expect(printed).not.toContain(NO_ADMIN_ACCESS_TEXT)
	})
})
