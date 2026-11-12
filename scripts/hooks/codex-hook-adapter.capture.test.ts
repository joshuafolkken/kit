import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { hook_decision } from '#scripts/josh/hook-decision'
import { hook_payload_capture } from '#scripts/josh/hook-payload-capture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codex_hook_adapter } from './codex-hook-adapter'

const make_directory = temporary_directory()

// A mode the adapter rejects, so the run captures and then stops without running a guard.
const UNKNOWN_MODE = 'unknown'
const BASH_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } })

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	process.exitCode = undefined
})

describe('codex_hook_adapter.run — payload capture', () => {
	it('captures the untranslated Codex payload under codex-<mode> when JOSH_HOOK_CAPTURE_DIR is set', async () => {
		const directory = make_directory('codex-hook-capture-')

		vi.stubEnv(hook_payload_capture.CAPTURE_DIR_KEY, directory)
		vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		await codex_hook_adapter.run(BASH_PAYLOAD, UNKNOWN_MODE)

		const file = path.join(directory, 'codex-unknown-Bash-1.json')

		expect(readdirSync(directory)).toStrictEqual([path.basename(file)])
		expect(readFileSync(file, 'utf8')).toBe(BASH_PAYLOAD)
	})
})
