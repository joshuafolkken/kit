import { describe, expect, it } from 'vitest'
import { security_audit_logic } from './security-audit-logic'

const BINARY_NAME = 'osv-scanner'
const LOCKFILE_PATH = 'pnpm-lock.yaml'

describe('security_audit_logic.BINARY_NAME', () => {
	it('is osv-scanner', () => {
		expect(security_audit_logic.BINARY_NAME).toBe(BINARY_NAME)
	})
})

describe('security_audit_logic.LOCKFILE_PATH', () => {
	it('targets pnpm-lock.yaml', () => {
		expect(security_audit_logic.LOCKFILE_PATH).toBe(LOCKFILE_PATH)
	})
})

describe('security_audit_logic.build_scanner_arguments', () => {
	it('returns lockfile flag with provided path', () => {
		const result = security_audit_logic.build_scanner_arguments(LOCKFILE_PATH)

		expect(result).toContain(`--lockfile=${LOCKFILE_PATH}`)
	})

	it('uses the passed lockfile path in the flag', () => {
		const custom_path = '/custom/path/lock.yaml'
		const result = security_audit_logic.build_scanner_arguments(custom_path)

		expect(result).toContain(`--lockfile=${custom_path}`)
	})
})

describe('security_audit_logic.format_missing_binary_error', () => {
	it('mentions the binary name', () => {
		const result = security_audit_logic.format_missing_binary_error(BINARY_NAME)

		expect(result).toContain(BINARY_NAME)
	})

	it('includes install instructions', () => {
		const result = security_audit_logic.format_missing_binary_error(BINARY_NAME)

		expect(result).toContain('Install options:')
	})
})
