import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_hooks, HOOK_BUNDLES, outfile_for } from './build-hooks'

const BUILD_TIMEOUT_MS = 60_000
const TSX_BIN = path.join('node_modules', '.bin', 'tsx')

interface RunResult {
	stdout: string
	exit_code: number | undefined
}

async function run(
	command: string,
	args: ReadonlyArray<string>,
	input: string,
): Promise<RunResult> {
	const { stdout, exitCode: exit_code } = await execa(command, [...args], {
		input,
		env: { JOSH_SESSION_LANG: 'fr' },
		reject: false,
	})

	return { stdout, exit_code }
}

// Compare the built bundle against the live source for one hook: same stdin, same stdout, same exit.
// The bundle regressing to a different verdict — or the self-invoke collision that empties the second
// stdin read — shows up here as a mismatch (joshuafolkken/kit#2023).
async function expect_parity(source: string, bundle: string, input: string): Promise<void> {
	const from_source = await run(TSX_BIN, [source], input)
	const from_bundle = await run('node', [bundle], input)

	expect(from_bundle).toEqual(from_source)
}

describe('build_hooks', () => {
	let directory: string

	beforeAll(async () => {
		await build_hooks()
		directory = mkdtempSync(path.join(tmpdir(), 'build-hooks-'))
		writeFileSync(
			path.join(directory, 't.jsonl'),
			'{"type":"assistant","message":{"content":[]}}\n',
		)
	}, BUILD_TIMEOUT_MS)

	afterAll(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	function payload(tool_name: string, tool_input: Record<string, unknown>): string {
		const transcript_path = path.join(directory, 't.jsonl')

		return JSON.stringify({ transcript_path, tool_name, tool_input })
	}

	it('builds every hook bundle', () => {
		for (const bundle of HOOK_BUNDLES) expect(existsSync(outfile_for(bundle))).toBe(true)
	})

	it('emits the session language identically to the source', async () => {
		await expect_parity('scripts/josh/session-language-cli.ts', 'dist/hooks/session-lang.js', '')
	})

	it('reaches the same guard decision as the source', async () => {
		const input = payload('Bash', { command: 'git commit -m x' })

		await expect_parity('scripts/hooks/pretool-guard.ts', 'dist/hooks/pretool-guard.js', input)
	})

	it('runs the format-edited hook identically to the source', async () => {
		const input = payload('Edit', { file_path: path.join(directory, 'absent.ts') })

		await expect_parity('scripts/hooks/format-edited-file.ts', 'dist/hooks/format-edited.js', input)
	})
})
