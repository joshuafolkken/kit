import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { build_hooks, HOOK_BUNDLES, outfile_for } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'
import { lane_cut_fixture } from './lane-cut-fixture'

const BUILD_TIMEOUT_MS = 60_000
const TSX_BIN = path.join('node_modules', '.bin', 'tsx')
const UNFORMATTED_JSON = '{"value":1}'
const CODEX_ADAPTER_SOURCE = 'scripts/hooks/codex-hook-adapter.ts'
const CODEX_ADAPTER_BUNDLE = 'dist/hooks/codex-hook-adapter.js'
const PRETOOL_BUNDLE = 'dist/hooks/pretool-guard.js'
const FORMAT_BUNDLE = 'dist/hooks/format-edited.js'

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
		// `JOSH_WATCHER_GUARD` is off so the composed watcher guard (joshuafolkken/kit#2353) does not read
		// this machine's live lane registry: it fires on ambient state, not the payload, and records a
		// once-per-run stamp — so source-then-bundle on a machine with lanes in-flight would fire once and
		// dedupe the second run, a mismatch that has nothing to do with the bundle. Its own behavior is
		// pinned in `run-watcher-hook.test.ts` and the composition in `pretool-guard.test.ts`.
		env: { JOSH_SESSION_LANG: 'fr', JOSH_WATCHER_GUARD: 'off' },
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

		await expect_parity('scripts/hooks/pretool-guard-cli.ts', PRETOOL_BUNDLE, input)
	})

	it('runs the format-edited hook identically to the source', async () => {
		const input = payload('Edit', { file_path: path.join(directory, 'absent.ts') })

		await expect_parity('scripts/hooks/format-edited-cli.ts', FORMAT_BUNDLE, input)
	})
})

// joshuafolkken/kit#2922: `codex-hook-adapter.ts` imports `pretool-guard.ts` and `format-edited-file.ts`,
// so code splitting moved their self-invoke into a shared chunk and the launched bundles ran nothing.
// Source and bundle both printing nothing passed the parity checks above, so these assert an effect.
describe('launched hook bundles run their main', () => {
	it('emits the pretool guard verdict rather than exiting silently', async () => {
		const result = await run('node', [PRETOOL_BUNDLE], 'not-json')

		expect(result.stdout).toContain('JOSH_BATCH_GUARD')
	})

	it(
		'formats the edited file',
		async () => {
			const file_path = path.join(format_directory, 'claude.json')

			writeFileSync(file_path, UNFORMATTED_JSON)
			await run('node', [FORMAT_BUNDLE], payload('Edit', { file_path }))

			expect(readFileSync(file_path, 'utf8')).not.toBe(UNFORMATTED_JSON)
		},
		BUILD_TIMEOUT_MS,
	)

	it('refuses an over-threshold edit in an uncut lane child', async () => {
		const lane = lane_cut_fixture.create_over_threshold_lane()

		onTestFinished(() => {
			lane_cut_fixture.remove(lane)
		})
		const result = await lane_cut_fixture.run_edit(lane)

		expect(result).toContain('⛔ implementation-phase cut:')
	})
})

function create_out_directory(): string {
	const out_directory = mkdtempSync(path.join(tmpdir(), 'build-hooks-out-'))

	onTestFinished(() => {
		rmSync(out_directory, { recursive: true, force: true })
	})

	return out_directory
}

// joshuafolkken/kit#2885: split builds emit freshly hashed chunks each time, so a chunk left from an
// earlier build has to be gone after the next one rather than shipping beside the live chunks.
describe('build_hooks output directory', () => {
	it(
		'removes a stale chunk left from an earlier build',
		async () => {
			const out_directory = create_out_directory()
			const stale_chunk = path.join(out_directory, 'chunk-STALE.js')

			writeFileSync(stale_chunk, 'export {}\n')
			await build_hooks(out_directory)

			expect(existsSync(stale_chunk)).toBe(false)
			const built = HOOK_BUNDLES.map((bundle) =>
				existsSync(path.join(out_directory, `${bundle.out}.js`)),
			)

			expect(built.every(Boolean)).toBe(true)
		},
		BUILD_TIMEOUT_MS,
	)

	// joshuafolkken/kit#2984: every file is renamed in from a private staging directory, which must not
	// be left beside the output, and the stamp it places last reads the fresh build as current.
	it(
		'places the build and its stamp without leaving the staging directory behind',
		async () => {
			const out_directory = create_out_directory()

			await build_hooks(out_directory)

			expect(existsSync(path.join(out_directory, hook_bundle_stamp.STAMP_NAME))).toBe(true)
			expect(hook_bundle_stamp.is_fresh(out_directory, process.cwd())).toBe(true)
			expect(readdirSync(path.dirname(out_directory))).not.toContainEqual(
				expect.stringMatching(/^\.hooks-staging-/u),
			)
		},
		BUILD_TIMEOUT_MS,
	)
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
