import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-logic'
import { security_audit_logic } from './security-audit-logic'

const OSV_SCANNER = 'osv-scanner'
const PNPM_LOCKFILE = 'pnpm-lock.yaml'
const RETIRED_AUDIT = 'pnpm audit'
const RETIRED_AUDIT_RUN = `run: ${RETIRED_AUDIT}`
const RETIRED_AUDIT_FRAGMENT = `${RETIRED_AUDIT} `

function load_file(relative_path: string): string {
	return readFileSync(path.resolve(process.cwd(), relative_path), 'utf8')
}

describe('security_audit_logic constants', () => {
	it('targets the osv-scanner binary', () => {
		expect(security_audit_logic.BINARY_NAME).toBe(OSV_SCANNER)
	})

	it('targets the pnpm lockfile at repo root', () => {
		expect(security_audit_logic.LOCKFILE_PATH).toBe(PNPM_LOCKFILE)
	})
})

describe('security_audit_logic.build_scanner_arguments', () => {
	it('returns --lockfile with the given path', () => {
		expect(security_audit_logic.build_scanner_arguments(PNPM_LOCKFILE)).toEqual([
			`--lockfile=${PNPM_LOCKFILE}`,
		])
	})

	it('preserves custom lockfile paths unchanged', () => {
		expect(security_audit_logic.build_scanner_arguments('app/pnpm-lock.yaml')).toEqual([
			'--lockfile=app/pnpm-lock.yaml',
		])
	})
})

describe('security_audit_logic.format_missing_binary_error', () => {
	const message = security_audit_logic.format_missing_binary_error(OSV_SCANNER)

	it('names the missing binary', () => {
		expect(message).toContain(`${OSV_SCANNER} is not installed`)
	})

	it('includes the brew install instruction', () => {
		expect(message).toContain('brew install osv-scanner')
	})

	it('includes the go install instruction', () => {
		expect(message).toContain('go install github.com/google/osv-scanner')
	})

	it('includes the Docker fallback', () => {
		expect(message).toContain('docker run')
	})

	it('links to the osv-scanner docs', () => {
		expect(message).toContain('https://google.github.io/osv-scanner/')
	})
})

describe('josh latest command audit wiring', () => {
	const manifest = JSON.parse(load_file('package.json')) as { scripts?: Record<string, string> }
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature forbids dot access on Record values
	const latest_command = (COMMAND_MAP['latest']?.shell ?? []).join(' ')

	it('does not register audit:security or latest as standalone package.json scripts', () => {
		/* eslint-disable dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature */
		expect(manifest.scripts?.['audit:security']).toBeUndefined()
		expect(manifest.scripts?.['latest']).toBeUndefined()
		/* eslint-enable dot-notation */
	})

	it('delegates security audit to josh audit in the COMMAND_MAP latest shell', () => {
		expect(latest_command).toContain('josh audit')
	})

	it('no longer calls the retired pnpm audit command', () => {
		expect(latest_command.trim().endsWith(RETIRED_AUDIT)).toBe(false)
		expect(latest_command).not.toContain(RETIRED_AUDIT_FRAGMENT)
	})
})

describe('lefthook/base.yml pre-commit audit wiring', () => {
	const content = load_file('lefthook/base.yml')
	const lines = content.split('\n').map((line) => line.trim())

	it('runs security audit via pnpm josh on pre-commit', () => {
		expect(content).toContain('run: pnpm josh audit')
	})

	it('does not call the retired pnpm audit command from the pre-commit hook', () => {
		expect(lines).not.toContain(RETIRED_AUDIT_RUN)
	})
})

describe('.github/workflows/ci.yml audit wiring', () => {
	const content = load_file('.github/workflows/ci.yml')
	const lines = content.split('\n').map((line) => line.trim())

	it('runs osv-scanner against the pnpm lockfile via the official GitHub Action', () => {
		expect(content).toContain('uses: google/osv-scanner-action/osv-scanner-action')
		expect(content).toContain(`scan-args: --lockfile=${PNPM_LOCKFILE}`)
	})

	it('does not call the retired pnpm audit command from CI', () => {
		expect(lines).not.toContain('run: pnpm audit --audit-level low')
		expect(lines).not.toContain(RETIRED_AUDIT_RUN)
	})
})
