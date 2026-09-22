import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { behavior_cli } from './behavior-cli'
import { behavior_test_fixture } from './behavior-test-fixture'

const SESSION = 'run-xyz'
const PASS_EXIT_CODE = 0
const FAIL_EXIT_CODE = 1
const TMP_PREFIX = 'behavior-cli-'
const { bash_line, GIT_STATUS, GIT_COMMIT, JOSH_GIT } = behavior_test_fixture

function session_file(file_path: string): SessionFile {
	return { session_id: SESSION, path: file_path, modified_ms: 0, is_delegated: false, depth: 0 }
}

function transcript_file(...commands: ReadonlyArray<string>): SessionFile {
	const directory = mkdtempSync(path.join(tmpdir(), TMP_PREFIX))
	const file_path = path.join(directory, `${SESSION}.jsonl`)

	writeFileSync(file_path, commands.map((command) => bash_line(command)).join('\n'))

	return session_file(file_path)
}

function missing_file(): SessionFile {
	return session_file(path.join(tmpdir(), `${TMP_PREFIX}missing`, 'nope.jsonl'))
}

function capture(): { info: Array<string>; error: Array<string> } {
	const info: Array<string> = []
	const error: Array<string> = []

	vi.spyOn(console, 'info').mockImplementation((message: string) => {
		info.push(message)
	})
	vi.spyOn(console, 'error').mockImplementation((message: string) => {
		error.push(message)
	})

	return { info, error }
}

afterEach(() => vi.restoreAllMocks())

describe('behavior_cli.check_session', () => {
	it('fails and names the run and the point of a direct index mutation', () => {
		const output = capture()

		const code = behavior_cli.check_session(transcript_file(GIT_STATUS, GIT_COMMIT))

		expect(code).toBe(FAIL_EXIT_CODE)
		expect(output.error.join('\n')).toContain(SESSION)
		expect(output.error.join('\n')).toContain('position 2')
	})

	it('passes a transcript that broke no assertion', () => {
		const output = capture()

		const code = behavior_cli.check_session(transcript_file(GIT_STATUS, JOSH_GIT))

		expect(code).toBe(PASS_EXIT_CODE)
		expect(output.info.join('\n')).toContain('green')
	})

	it('passes an unreadable transcript without the skip marker', () => {
		const output = capture()

		const code = behavior_cli.check_session(missing_file())

		expect(code).toBe(PASS_EXIT_CODE)
		expect(output.info.join('\n')).not.toContain('skipping')
	})
})

describe('behavior_cli.run', () => {
	it('passes when no transcript is filed under the working directory', () => {
		capture()
		const cwd = path.join(tmpdir(), `${TMP_PREFIX}no-such-project-dir`)

		expect(behavior_cli.run(cwd)).toBe(PASS_EXIT_CODE)
	})
})
