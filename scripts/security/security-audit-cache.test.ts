import { readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { security_audit_cache, type AuditPorts } from './security-audit-cache'

const { with_command_reservation, scanner_run } = vi.hoisted(() => ({
	with_command_reservation: vi.fn(
		async (_weight: number, step: () => Promise<number>) => await step(),
	),
	scanner_run: vi.fn(() => 0),
}))

vi.mock('#scripts/gate/core-budget', () => ({ core_budget: { with_command_reservation } }))
vi.mock('./security-audit', () => ({ security_audit: { run: scanner_run } }))

const { PASS_LIFETIME_MS, pass_directory, reserved_audit, run } = security_audit_cache
const AUDIT_CORE_WEIGHT = 1
const LOCKFILE = 'pnpm-lock.yaml'
const ORIGINAL_LOCKFILE = 'lockfileVersion: 9.0\n'
const CHANGED_LOCKFILE = 'lockfileVersion: 9.0\nchanged: true\n'
const START_MS = Date.UTC(2026, 10, 10)
const SUCCESS = 0
const FAILURE = 1
const SKIP_LINE = /^✔ audit skipped — pnpm-lock\.yaml unchanged since its clean scan at /u

const make_directory = temporary_directory()

interface Scenario {
	root: string
	clock: { now_ms: number }
	audit: ReturnType<typeof vi.fn<() => Promise<number>>>
	ports: AuditPorts
	info: MockInstance<typeof console.info>
}

function write_lockfile(root: string, content: string): void {
	writeFileSync(path.join(root, LOCKFILE), content)
}

function scenario(exit_code: number = SUCCESS, is_trusted = true): Scenario {
	const root = make_directory('kit-audit-cache-')
	const clock = { now_ms: START_MS }
	const audit = vi.fn(async () => await exit_code)
	const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
	const ports = {
		root,
		now: (): number => clock.now_ms,
		audit,
		is_trusted: (): boolean => is_trusted,
	}

	write_lockfile(root, ORIGINAL_LOCKFILE)

	return { root, clock, audit, info, ports }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('security_audit_cache.run on a recorded lockfile', () => {
	it('scans and records a clean scan of a lockfile with no record', async () => {
		const { root, audit, ports } = scenario()

		expect(await run(ports)).toBe(SUCCESS)
		expect(audit).toHaveBeenCalledOnce()
		expect(readdirSync(pass_directory(root))).toHaveLength(1)
	})

	it('skips the scan with one line while the same lockfile has a live record', async () => {
		const { clock, audit, info, ports } = scenario()

		await run(ports)
		clock.now_ms += PASS_LIFETIME_MS - 1

		expect(await run(ports)).toBe(SUCCESS)
		expect(audit).toHaveBeenCalledOnce()
		expect(info).toHaveBeenCalledOnce()
		expect(info.mock.calls[0]?.[0]).toMatch(SKIP_LINE)
	})
})

describe('security_audit_cache.run scanning again', () => {
	it('scans again once the lockfile changes', async () => {
		const { root, audit, info, ports } = scenario()

		await run(ports)
		write_lockfile(root, CHANGED_LOCKFILE)
		await run(ports)

		expect(audit).toHaveBeenCalledTimes(2)
		expect(info).not.toHaveBeenCalled()
	})

	it('scans again once the record has expired, and prunes the expired one', async () => {
		const { root, clock, audit, info, ports } = scenario()

		await run(ports)
		write_lockfile(root, CHANGED_LOCKFILE)
		clock.now_ms += PASS_LIFETIME_MS
		await run(ports)
		write_lockfile(root, ORIGINAL_LOCKFILE)
		await run(ports)

		expect(audit).toHaveBeenCalledTimes(3)
		expect(info).not.toHaveBeenCalled()
		expect(readdirSync(pass_directory(root))).toHaveLength(2)
	})
})

describe('security_audit_cache.run recording nothing', () => {
	it('returns a failed scan unchanged and records nothing, so the next push scans', async () => {
		const { audit, ports } = scenario(FAILURE)

		expect(await run(ports)).toBe(FAILURE)
		expect(await run(ports)).toBe(FAILURE)
		expect(audit).toHaveBeenCalledTimes(2)
	})

	it('records no clean scan from a below-floor scanner, so the next push scans', async () => {
		const { audit, ports } = scenario(SUCCESS, false)

		expect(await run(ports)).toBe(SUCCESS)
		expect(await run(ports)).toBe(SUCCESS)
		expect(audit).toHaveBeenCalledTimes(2)
	})

	it('scans and records nothing when there is no lockfile', async () => {
		const { root, audit, ports } = scenario()

		rmSync(path.join(root, LOCKFILE))

		expect(await run(ports)).toBe(SUCCESS)
		expect(await run(ports)).toBe(SUCCESS)
		expect(audit).toHaveBeenCalledTimes(2)
	})
})

describe('security_audit_cache.reserved_audit', () => {
	it('runs the scanner under a one-core reservation and answers its exit code', async () => {
		scanner_run.mockReturnValueOnce(FAILURE)

		expect(await reserved_audit()).toBe(FAILURE)
		expect(with_command_reservation).toHaveBeenCalledWith(AUDIT_CORE_WEIGHT, expect.any(Function), {
			command: 'audit',
		})
		expect(scanner_run).toHaveBeenCalledOnce()
	})
})
