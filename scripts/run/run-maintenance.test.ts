import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detached_launch } from './detached-launch'
import { run_maintenance } from './run-maintenance'

const { execa } = vi.hoisted(() => ({ execa: vi.fn() }))

vi.mock('execa', () => ({ execa }))
vi.mock('./detached-launch', () => ({ detached_launch: { launch: vi.fn() } }))

const ISSUE = '6255'
const MINUTE_MS = 60_000
const launch = vi.mocked(detached_launch.launch)

beforeEach(() => {
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	launch.mockReturnValue({ kind: 'launched', pid: 1 })
})

afterEach(() => vi.restoreAllMocks())

describe('run maintenance', () => {
	it('caps the complete label process and records a retry (ac-ed406ee7)', async () => {
		execa.mockResolvedValue({ exitCode: 1, timedOut: true })

		expect(await run_maintenance.label(ISSUE)).toBe(false)
		expect(execa).toHaveBeenCalledWith(process.execPath, expect.any(Array), {
			reject: false,
			timeout: MINUTE_MS,
		})
		const [request] = launch.mock.calls[0] ?? []

		expect(request?.argv.args).toEqual(expect.arrayContaining([ISSUE, '--retry']))
		expect(request?.log_path).toContain(`josh-run-label-retry-${ISSUE}-`)
		expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('60s timeout'))
	})

	it('does not retry a completed label write', async () => {
		execa.mockResolvedValue({ exitCode: 0 })

		expect(await run_maintenance.label(ISSUE)).toBe(true)
		expect(launch).not.toHaveBeenCalled()
	})

	it('returns without waiting for the detached sweep (ac-cc91653f)', () => {
		run_maintenance.sweep()

		const [request] = launch.mock.calls[0] ?? []

		expect(request?.argv.args.join(' ')).toContain('run-tidy-main.ts')
		expect(request?.log_path).toContain('josh-run-sweep-')
		expect(execa).not.toHaveBeenCalled()
	})
})
