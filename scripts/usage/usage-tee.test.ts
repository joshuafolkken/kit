import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usage_state_path } from './usage-state-path'
import { usage_tee } from './usage-tee'

const FIVE_HOUR = { used_percentage: 23.5, resets_at: 1_738_425_600 }
const SEVEN_DAY = { used_percentage: 41.2, resets_at: 1_738_857_600 }
const AT = '2026-11-04T00:00:00.000Z'
const context = { directory: '' }
const make_directory = temporary_directory()

function read_state(): unknown {
	return JSON.parse(readFileSync(usage_state_path.claude(), 'utf8'))
}

async function feed(raw: string): Promise<void> {
	const stdin = Object.assign(Readable.from([raw]), { isTTY: false, fd: 0 })

	vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin)
	await usage_tee.run()
}

beforeEach(() => {
	context.directory = make_directory('usage-tee-')
	vi.stubEnv('CLAUDE_CONFIG_DIR', context.directory)
	vi.useFakeTimers()
	vi.setSystemTime(new Date(AT))
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	vi.useRealTimers()
})

it('records both windows from stdin (ac-66991e10)', async () => {
	await feed(JSON.stringify({ rate_limits: { five_hour: FIVE_HOUR, seven_day: SEVEN_DAY } }))

	expect(read_state()).toEqual({
		five_hour: FIVE_HOUR,
		seven_day: SEVEN_DAY,
		at: AT,
	})
})

it('leaves existing state unchanged without rate_limits (ac-dff3fdb7)', async () => {
	await feed(JSON.stringify({ rate_limits: { five_hour: FIVE_HOUR } }))
	const previous = readFileSync(usage_state_path.claude(), 'utf8')

	await feed('{"session_id":"another-session"}')

	expect(readFileSync(usage_state_path.claude(), 'utf8')).toBe(previous)
})

it.each(['five_hour', 'seven_day'])(
	'marks a missing window unknown after receiving only %s (ac-981f94d2)',
	async (window: string) => {
		const both = { five_hour: FIVE_HOUR, seven_day: SEVEN_DAY }
		const incoming = window === 'five_hour' ? FIVE_HOUR : SEVEN_DAY

		await feed(JSON.stringify({ rate_limits: both }))
		await feed(JSON.stringify({ rate_limits: { [window]: incoming } }))

		expect(read_state()).toEqual({
			// eslint-disable-next-line unicorn/no-null -- JSON contract for unknown windows.
			five_hour: null,
			// eslint-disable-next-line unicorn/no-null
			seven_day: null,
			[window]: incoming,
			at: AT,
		})
	},
)

it.each(['', '{broken', 'null', '{}', '{"rate_limits":null}'])(
	'ignores invalid or missing input silently: %s (ac-535ff88a)',
	async (raw: string) => {
		const output = vi.spyOn(process.stdout, 'write')

		await feed(raw)

		expect(output).not.toHaveBeenCalled()
		expect(existsSync(usage_state_path.claude())).toBe(false)
	},
)

it('keeps successful writes and filesystem failures silent', async () => {
	const output = vi.spyOn(process.stdout, 'write')
	const errors = vi.spyOn(process.stderr, 'write')

	await feed(JSON.stringify({ rate_limits: { five_hour: FIVE_HOUR } }))
	const blocked = path.join(context.directory, 'blocked')

	writeFileSync(blocked, '')
	vi.stubEnv('CLAUDE_CONFIG_DIR', blocked)
	await feed(JSON.stringify({ rate_limits: { five_hour: FIVE_HOUR } }))

	expect(output).not.toHaveBeenCalled()
	expect(errors).not.toHaveBeenCalled()
})

it('keeps an existing observation unchanged for malformed payloads', async () => {
	await feed(JSON.stringify({ rate_limits: { five_hour: FIVE_HOUR } }))
	const previous = readFileSync(usage_state_path.claude(), 'utf8')

	await feed('{broken')
	await feed('{"rate_limits":{"five_hour":{"used_percentage":"unknown","resets_at":0}}}')

	expect(readFileSync(usage_state_path.claude(), 'utf8')).toBe(previous)
})

it('returns immediately for a terminal without creating a record', async () => {
	const stdin = Object.assign(Readable.from([]), { isTTY: true, fd: 0 })

	vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin)
	await usage_tee.run()

	expect(existsSync(usage_state_path.claude())).toBe(false)
})
