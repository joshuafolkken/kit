import { describe, expect, it } from 'vitest'
import { repo_setting } from './repo-setting'
import { security_updates_logic, type SecurityUpdatesStatus } from './security-updates-logic'

const OK = 0
const NOT_FOUND = 1
const REPO = 'joshuafolkken/app-kit'
const ENABLED_BODY = '{"enabled":true,"paused":false}'
const NOT_FOUND_BODY = '{"message":"Not Found","status":"404"}'
const NO_ADMIN_ACCESS_TEXT = 'No admin access'
const SECURITY_PAGE_TEXT = 'Security → Dependabot'

function classify(exit_code: number, stdout: string): SecurityUpdatesStatus {
	return security_updates_logic.classify_security_updates(exit_code, stdout)
}

function report(status: SecurityUpdatesStatus): string {
	return security_updates_logic.format_security_updates_report(status, REPO).join('\n')
}

function report_without_repo(status: SecurityUpdatesStatus): string {
	return security_updates_logic.format_security_updates_report(status, undefined).join('\n')
}

describe('classify_security_updates', () => {
	it('reports enabled when the setting is on and not paused', () => {
		expect(classify(OK, ENABLED_BODY)).toBe('enabled')
	})

	it('reports paused when the setting is on but paused, because no advisory PR is opened', () => {
		expect(classify(OK, '{"enabled":true,"paused":true}')).toBe('paused')
	})

	it('treats a missing paused field as not paused, for older API responses', () => {
		expect(classify(OK, '{"enabled":true}')).toBe('enabled')
	})

	it('reports disabled when the setting is explicitly off', () => {
		expect(classify(OK, '{"enabled":false,"paused":false}')).toBe('disabled')
	})

	it('reports unreadable on a non-zero exit, so a 404 is not mistaken for disabled', () => {
		expect(classify(NOT_FOUND, NOT_FOUND_BODY)).toBe('unreadable')
	})

	it('reports unreadable when the response is not valid JSON', () => {
		expect(classify(OK, 'gh: could not authenticate')).toBe('unreadable')
	})

	it('reports unreadable when enabled is absent from an otherwise valid payload', () => {
		expect(classify(OK, '{"paused":false}')).toBe('unreadable')
	})

	it('reports unreadable when enabled is not a boolean', () => {
		expect(classify(OK, '{"enabled":"true"}')).toBe('unreadable')
	})

	it('reports unreadable when the payload is a JSON literal rather than an object', () => {
		expect(classify(OK, 'null')).toBe('unreadable')
	})

	// `paused` is held to the same standard as `enabled`: a truthy non-boolean must not be read as
	// "not paused" and reported as a clean `enabled`.
	it('reports unreadable when paused is present but not a boolean', () => {
		expect(classify(OK, '{"enabled":true,"paused":"true"}')).toBe('unreadable')
		expect(classify(OK, '{"enabled":true,"paused":1}')).toBe('unreadable')
	})
})

describe('is_exposed', () => {
	it('treats disabled and paused as exposed, because neither opens an advisory PR', () => {
		expect(security_updates_logic.is_exposed('disabled')).toBe(true)
		expect(security_updates_logic.is_exposed('paused')).toBe(true)
	})

	it('does not treat unreadable as exposed, because a missing answer is not a negative one', () => {
		expect(security_updates_logic.is_exposed('unreadable')).toBe(false)
	})

	it('does not treat enabled as exposed', () => {
		expect(security_updates_logic.is_exposed('enabled')).toBe(false)
	})
})

describe('format_security_updates_report', () => {
	it('reports enabled on a single line with no remediation', () => {
		const lines = security_updates_logic.format_security_updates_report('enabled', REPO)

		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain('enabled')
		expect(lines[0]).toContain(REPO)
	})

	it('names the repository so a multi-repo session cannot misattribute the warning', () => {
		expect(report('disabled')).toContain(REPO)
	})

	it('cites the origin issue so the reader can find why npm version updates stopped', () => {
		expect(report('disabled')).toContain('joshuafolkken/kit#803')
	})
})

describe('format_security_updates_report remediation', () => {
	it('includes the enabling command when the setting is off', () => {
		expect(report('disabled')).toContain(security_updates_logic.enable_command(REPO))
	})

	it('addresses the enabling command at the resolved repository, not a placeholder', () => {
		const lines = report('disabled')

		expect(lines).toContain(`repos/${REPO}/automated-security-fixes`)
		expect(lines).not.toContain('<owner>')
	})

	it('omits the enabling command when paused, because the endpoint cannot clear a pause', () => {
		const lines = report('paused')

		expect(lines).not.toContain('-X PUT')
		expect(lines).toContain('does not clear a pause')
	})

	it('explains that a paused setting differs from an absent one', () => {
		expect(report('paused')).toContain('paused')
		expect(report('disabled')).not.toContain('but paused')
	})
})

describe('format_security_updates_report unreadable', () => {
	it('states that an unreadable setting was not checked rather than found off', () => {
		const lines = report('unreadable')

		expect(lines).toContain('not necessarily off')
		expect(lines).not.toContain('-X PUT')
	})

	it('falls back to a placeholder when the repository cannot be resolved', () => {
		expect(report_without_repo('unreadable')).toContain(repo_setting.UNKNOWN_REPOSITORY)
	})

	// An unidentified repository has different causes, and pointing at a Security page would name no
	// page the reader can open.
	it('explains an unidentified repository rather than blaming admin access', () => {
		const lines = report_without_repo('unreadable')

		expect(lines).toContain('could not be identified')
		expect(lines).not.toContain(NO_ADMIN_ACCESS_TEXT)
		expect(lines).not.toContain(SECURITY_PAGE_TEXT)
	})

	// A 404 covers both a token without admin access and a repository where Dependabot is off; the
	// response cannot separate them, so both are named.
	it('names both 404 causes of an unreadable answer', () => {
		const lines = report('unreadable')

		expect(lines).toContain(NO_ADMIN_ACCESS_TEXT)
		expect(lines).toContain('Dependabot not enabled')
	})
})

describe('format_security_updates_report unreadable causes', () => {
	// The same branch catches a timeout and an offline run, so no single cause may be asserted.
	it('lists a failed request among the causes rather than blaming access alone', () => {
		expect(report('unreadable')).toContain('the request failed')
	})

	it('points at the page that can resolve the ambiguity', () => {
		expect(report('unreadable')).toContain(SECURITY_PAGE_TEXT)
	})

	it('does not double-wrap the placeholder in parentheses', () => {
		expect(report_without_repo('unreadable')).not.toContain('((')
	})

	it('keeps the enabling command usable when the repository is unknown', () => {
		expect(security_updates_logic.enable_command(undefined)).toContain('<owner>/<repo>')
	})

	// A bare `#803` resolves inside whichever repository the reader is looking at, and this text is
	// printed in consumers — so every occurrence must carry the owner/repo prefix.
	it('never prints a bare issue reference', () => {
		expect(report('disabled')).not.toMatch(/(?<!joshuafolkken\/kit)#803/u)
	})
})
