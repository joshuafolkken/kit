import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build_hooks, HOOK_BUNDLES, outfile_for } from './build-hooks'

const BUILD_TIMEOUT_MS = 60_000
const TSX_BIN = path.join('node_modules', '.bin', 'tsx')
const UNFORMATTED_JSON = '{"value":1}'
const CODEX_ADAPTER_SOURCE = 'scripts/hooks/codex-hook-adapter.ts'
const CODEX_ADAPTER_BUNDLE = 'dist/hooks/codex-hook-adapter.js'

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

async function expect_adapter_parity(mode: string, input: string): Promise<void> {
	const source = await run(TSX_BIN, [CODEX_ADAPTER_SOURCE, mode], input)
	const bundle = await run('node', [CODEX_ADAPTER_BUNDLE, mode], input)

	expect(bundle).toEqual(source)
}

const directory = mkdtempSync(path.join(tmpdir(), 'build-hooks-'))
const format_directory = mkdtempSync(path.join(process.cwd(), '.codex-hook-fixture-'))

writeFileSync(path.join(directory, 't.jsonl'), '{"type":"assistant","message":{"content":[]}}\n')

beforeAll(async () => {
	await build_hooks()
}, BUILD_TIMEOUT_MS)

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
	rmSync(format_directory, { recursive: true, force: true })
})

function payload(tool_name: string, tool_input: Record<string, unknown>): string {
	const transcript_path = path.join(directory, 't.jsonl')

	return JSON.stringify({ transcript_path, tool_name, tool_input })
}

function patch_payload(file_path: string): string {
	const command = `*** Begin Patch\n*** Update File: ${file_path}\n*** End Patch`

	return payload('apply_patch', { command })
}

async function format_with_entrypoint(
	file_path: string,
	command: string,
	entrypoint: string,
): Promise<{ content: string; result: RunResult }> {
	writeFileSync(file_path, UNFORMATTED_JSON)
	const result = await run(command, [entrypoint, 'posttool'], patch_payload(file_path))

	return { content: readFileSync(file_path, 'utf8'), result }
}

describe('build_hooks', () => {
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

describe('Codex adapter bundle', () => {
	it('runs the Codex pretool adapter identically to the source', async () => {
		await expect_adapter_parity('pretool', patch_payload('absent.ts'))
	})

	it(
		'formats equivalent existing files through source and built entrypoints',
		async () => {
			const source_file = path.join(format_directory, 'source.json')
			const bundle_file = path.join(format_directory, 'bundle.json')
			const source = await format_with_entrypoint(source_file, TSX_BIN, CODEX_ADAPTER_SOURCE)
			const bundle = await format_with_entrypoint(bundle_file, 'node', CODEX_ADAPTER_BUNDLE)

			expect(bundle.result).toEqual(source.result)
			expect(bundle.content).toBe(source.content)
			expect(source.content).not.toBe(UNFORMATTED_JSON)
		},
		BUILD_TIMEOUT_MS,
	)
})
