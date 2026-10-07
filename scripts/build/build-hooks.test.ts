import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { step_zero_notice } from '#scripts/hooks/step-zero-notice'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { build_hooks, HOOK_BUNDLES, outfile_for } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'
import { lane_cut_fixture } from './lane-cut-fixture'

const BUILD_TIMEOUT_MS = 60_000
const REPO_ROOT = process.cwd()
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
const UNFORMATTED_JSON = '{"value":1}'
const CODEX_ADAPTER_SOURCE = 'scripts/hooks/codex-hook-adapter.ts'
const CODEX_ADAPTER_BUNDLE = 'dist/hooks/codex-hook-adapter.js'
const PRETOOL_BUNDLE = 'dist/hooks/pretool-guard.js'
const FORMAT_BUNDLE = 'dist/hooks/format-edited.js'

// Linked into the format fixture so the hook, run from there, finds this project's prettier binary
// and config exactly as it does from the repository root.
const FORMAT_LINKS = ['node_modules', 'prettier.config.js']

// The format fixture lives outside the repository: `pnpm pack` walks every directory under the root —
// ignore files included — so a fixture removed there between its readdir and stat failed the
// pack-boundary test (joshuafolkken/kit#3372). The hook formats only files under its working
// directory, so its runs use the fixture as that directory. The path is resolved because the hook's
// working directory is: a symlinked tmpdir (macOS `/var` → `/private/var`) would read as outside it.
function create_format_directory(): string {
	const created = mkdtempSync(path.join(tmpdir(), 'codex-hook-'))
	const format_root = realpathSync(created)

	for (const name of FORMAT_LINKS) {
		symlinkSync(path.join(REPO_ROOT, name), path.join(format_root, name))
	}

	return format_root
}

const directory = mkdtempSync(path.join(tmpdir(), 'build-hooks-'))
const format_directory = create_format_directory()
const TRANSCRIPT_PATH = path.join(directory, 't.jsonl')

interface RunResult {
	stdout: string
	exit_code: number | undefined
}

async function run(
	command: string,
	args: ReadonlyArray<string>,
	input: string,
	cwd: string = REPO_ROOT,
): Promise<RunResult> {
	// The Step 0 notice speaks once per transcript (joshuafolkken/kit#2994), so the first of a
	// source-then-bundle pair would spend it and the second run silently. Each run starts unstamped.
	rmSync(step_zero_notice.stamp_path(TRANSCRIPT_PATH), { force: true })
	const { stdout, exitCode: exit_code } = await execa(command, [...args], {
		cwd,
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

writeFileSync(TRANSCRIPT_PATH, '{"type":"assistant","message":{"content":[]}}\n')

beforeAll(async () => {
	await build_hooks()
}, BUILD_TIMEOUT_MS)

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
	rmSync(format_directory, { recursive: true, force: true })
})

function payload(tool_name: string, tool_input: Record<string, unknown>): string {
	return JSON.stringify({ transcript_path: TRANSCRIPT_PATH, tool_name, tool_input })
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
	const result = await run(
		command,
		[path.resolve(entrypoint), 'posttool'],
		patch_payload(file_path),
		format_directory,
	)

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

	it('keeps the format fixture outside the repository pnpm pack walks', () => {
		const relative = path.relative(REPO_ROOT, format_directory)

		expect(relative.split(path.sep)[0]).toBe('..')
	})

	it(
		'formats the edited file',
		async () => {
			const file_path = path.join(format_directory, 'claude.json')

			writeFileSync(file_path, UNFORMATTED_JSON)
			await run(
				'node',
				[path.resolve(FORMAT_BUNDLE)],
				payload('Edit', { file_path }),
				format_directory,
			)

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
			// Concurrent: each side formats its own file, and the posttool path never reads the Step 0
			// stamp the sequential pretool parity runs have to clear between them.
			const [source, bundle] = await Promise.all([
				format_with_entrypoint(source_file, TSX_BIN, CODEX_ADAPTER_SOURCE),
				format_with_entrypoint(bundle_file, 'node', CODEX_ADAPTER_BUNDLE),
			])

			expect(bundle.result).toEqual(source.result)
			expect(bundle.content).toBe(source.content)
			expect(source.content).not.toBe(UNFORMATTED_JSON)
		},
		BUILD_TIMEOUT_MS,
	)
})
