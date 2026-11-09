import { readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { hook_payload_capture } from './hook-payload-capture'

const make_directory = temporary_directory()

const { CAPTURE_DIR_KEY, capture } = hook_payload_capture
const PRETOOL_HOOK = 'pretool:guard'
const STOP_HOOK = 'stop:guard'
const BASH_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })
const STOP_PAYLOAD = JSON.stringify({ hook_event_name: 'Stop' })
const FIRST_STOP_CAPTURE = 'stop-guard-none-1.json'
const MISSING_DIRECTORY = 'nested'

function fresh_directory(): string {
	return make_directory('hook-capture-')
}

function capturing_into(directory: string): NodeJS.ProcessEnv {
	return { [CAPTURE_DIR_KEY]: directory }
}

describe('hook_payload_capture.capture', () => {
	it('writes nothing when JOSH_HOOK_CAPTURE_DIR is unset or empty', () => {
		const directory = fresh_directory()

		expect(capture(PRETOOL_HOOK, BASH_PAYLOAD, {})).toBeUndefined()
		expect(capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(''))).toBeUndefined()
		expect(readdirSync(directory)).toStrictEqual([])
	})

	it('saves the raw payload as <hook>-<tool>-<n>.json, numbered per hook and tool', () => {
		const directory = fresh_directory()

		capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(directory))
		const second = capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(directory))

		expect(second).toBe(path.join(directory, 'pretool-guard-Bash-2.json'))
		expect(readFileSync(second ?? '', 'utf8')).toBe(BASH_PAYLOAD)
	})

	it('labels a payload with no tool as none', () => {
		const directory = fresh_directory()

		expect(capture(STOP_HOOK, STOP_PAYLOAD, capturing_into(directory))).toBe(
			path.join(directory, FIRST_STOP_CAPTURE),
		)
	})
})

describe('hook_payload_capture.capture — the target directory', () => {
	it('moves past an index already taken instead of dropping the payload', () => {
		const directory = fresh_directory()

		capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(directory))
		capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(directory))
		rmSync(path.join(directory, 'pretool-guard-Bash-1.json'))

		expect(capture(PRETOOL_HOOK, BASH_PAYLOAD, capturing_into(directory))).toBe(
			path.join(directory, 'pretool-guard-Bash-3.json'),
		)
	})

	it('creates a missing capture directory', () => {
		const nested = path.join(fresh_directory(), MISSING_DIRECTORY)

		expect(capture('codex-pretool', BASH_PAYLOAD, capturing_into(nested))).toBe(
			path.join(nested, 'codex-pretool-Bash-1.json'),
		)
	})

	it('leaves the call uncaptured when the directory cannot be made', () => {
		const directory = fresh_directory()

		capture(STOP_HOOK, STOP_PAYLOAD, capturing_into(directory))
		const under_a_file = path.join(directory, FIRST_STOP_CAPTURE, MISSING_DIRECTORY)

		expect(capture(STOP_HOOK, STOP_PAYLOAD, capturing_into(under_a_file))).toBeUndefined()
	})
})
