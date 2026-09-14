import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MISSING_NOTICE, secretlint_scan } from './secretlint-scan'

const STAGED_FILES = ['src/(app)/[id]/+page.svelte', 'README.md']
const BIN_NAME = process.platform === 'win32' ? 'secretlint.cmd' : 'secretlint'

const ctx = { project_root: '' }

function install_secretlint_binary(): string {
	const bin_directory = path.join(ctx.project_root, 'node_modules', '.bin')
	const bin_path = path.join(bin_directory, BIN_NAME)

	mkdirSync(bin_directory, { recursive: true })
	writeFileSync(bin_path, '')

	return bin_path
}

beforeEach(() => {
	ctx.project_root = mkdtempSync(path.join(tmpdir(), 'secretlint-scan-'))
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(ctx.project_root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('secretlint_scan.resolve_secretlint_binary', () => {
	it('returns undefined when the project has no secretlint bin shim', () => {
		expect(secretlint_scan.resolve_secretlint_binary(ctx.project_root)).toBeUndefined()
	})

	it('returns the shim path once secretlint is installed', () => {
		const expected = install_secretlint_binary()

		expect(secretlint_scan.resolve_secretlint_binary(ctx.project_root)).toBe(expected)
	})
})

describe('secretlint_scan.build_scan_arguments', () => {
	// lefthook substitutes literal paths, so a route directory such as `(app)` or `[id]`
	// reaches secretlint's glob engine as a pattern unless --no-glob is passed.
	it('passes --no-glob ahead of the staged files', () => {
		expect(secretlint_scan.build_scan_arguments(STAGED_FILES)).toStrictEqual([
			'--no-glob',
			...STAGED_FILES,
		])
	})

	// Masking is on by default in v13 and --maskSecrets is not a real flag; the CLI parser
	// swallows it silently, so an unmasked secret would reach the terminal unnoticed.
	it('does not pass the non-existent --maskSecrets flag', () => {
		expect(secretlint_scan.build_scan_arguments(STAGED_FILES)).not.toContain('--maskSecrets')
	})

	// --secretlintignore expects a .secretlintignore file; pointing it at .gitignore quietly
	// corrupts the ignore set, and v13 already respects the .gitignore cascade.
	it('does not pass --secretlintignore', () => {
		expect(secretlint_scan.build_scan_arguments(STAGED_FILES)).not.toContain('--secretlintignore')
	})
})

describe('secretlint_scan.plan_scan', () => {
	it('skips without a notice when nothing is staged', () => {
		expect(secretlint_scan.plan_scan([], ctx.project_root)).toStrictEqual({ kind: 'skip' })
	})

	// A kit upgrade activates the hook before `josh sync` + `pnpm install` provisions the
	// binary. Failing here would block every commit in that window (kit#695).
	it('skips with an actionable notice when secretlint is not installed', () => {
		const decision = secretlint_scan.plan_scan(STAGED_FILES, ctx.project_root)

		expect(decision).toStrictEqual({ kind: 'skip', notice: MISSING_NOTICE })
	})

	it('scans with the resolved shim when secretlint is installed', () => {
		const binary = install_secretlint_binary()

		expect(secretlint_scan.plan_scan(STAGED_FILES, ctx.project_root)).toStrictEqual({
			kind: 'scan',
			binary,
		})
	})
})

describe('secretlint_scan.main', () => {
	it('exits zero and warns when secretlint is missing', () => {
		expect(secretlint_scan.main(STAGED_FILES, ctx.project_root)).toBe(0)
		expect(console.warn).toHaveBeenCalledWith(MISSING_NOTICE)
	})

	it('exits zero without warning when nothing is staged', () => {
		expect(secretlint_scan.main([], ctx.project_root)).toBe(0)
		expect(console.warn).not.toHaveBeenCalled()
	})
})

describe('MISSING_NOTICE', () => {
	// The notice is the only thing standing between a skipped scan and an unnoticed gap,
	// so it has to name the exact recovery command.
	it('tells the developer how to provision secretlint', () => {
		expect(MISSING_NOTICE).toContain('pnpm josh sync && pnpm install')
	})
})
