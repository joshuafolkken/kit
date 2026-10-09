#!/usr/bin/env tsx
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { error_text } from '#scripts/lib/error-message'
import { build, type OnLoadArgs, type OutputFile, type Plugin, type PluginBuild } from 'esbuild'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const { STAMP_NAME } = hook_bundle_stamp
const CHUNK_PREFIX = 'chunk-'
const STAGING_PREFIX = '.hooks-staging-'
// esbuild compiles a plugin filter as a Go regexp, which rejects the `u` flag.
// eslint-disable-next-line require-unicode-regexp
const ANY_PATH = /.*/

// Each Claude Code hook is bundled to its own `dist/hooks/<name>.js`, so a consumer (and kit itself)
// invokes `node dist/hooks/<name>.js` directly — no `pnpm` launch and no `tsx` re-spawn from the
// `dist/josh.js` dispatcher.
//
// **`splitting: true` is load-bearing, not an optimization.** Every hook module decides whether to
// run its main from `process.argv[1] === fileURLToPath(import.meta.url)`. A single-file bundle would
// collapse every imported module's `import.meta.url` to the one output path, so a call to
// `node dist/hooks/pretool-guard.js` would fire the self-invoke of `batch-guard` and
// `investigation-guard` too — each reads stdin, and the second read gets an empty payload. Code
// splitting keeps every entry in its own file with its own `import.meta.url`, so an imported guard's
// `import.meta.url` never equals `argv[1]` and only the file actually launched runs its main.
//
// **The flip side: an entry another entry imports loses its main**. Splitting
// moves a module two entries share into a chunk, so a launched hook whose own module is imported
// elsewhere becomes a re-export stub that runs nothing. Each launched hook is therefore a `*-cli.ts`
// file holding only the self-invoke, which no other module imports.
//
// `packages: 'external'` keeps bare dependencies as runtime imports the consumer resolves from kit's
// node_modules, exactly as the library bundles do, while kit's internal `#scripts/*` graph is inlined.
// No shebang banner is added: unlike `dist/josh.js` (the `bin.josh` entry, executed directly), a hook
// bundle is always launched as `node <path>`.
interface HookBundle {
	source: string
	out: string
}

// The settings.json hooks (the session-start audit provisioner among them), the Codex input adapter, and the three guards `pretool-guard`
// composes: `batch-guard`, `investigation-guard` and `duplicate-read-guard` each self-invoke, so they
// must be their own entries to keep their `import.meta.url` out of `pretool-guard`'s file.
// `delivered-rules` (the fourth guard) has no self-invoke, so it stays inlined.
const HOOK_BUNDLES: ReadonlyArray<HookBundle> = [
	{ source: 'scripts/hooks/codex-hook-adapter.ts', out: 'codex-hook-adapter' },
	{ source: 'scripts/hooks/pretool-guard-cli.ts', out: 'pretool-guard' },
	{ source: 'scripts/hooks/stop-guard.ts', out: 'stop-guard' },
	{ source: 'scripts/hooks/format-edited-cli.ts', out: 'format-edited' },
	{ source: 'scripts/josh/session-language-cli.ts', out: 'session-lang' },
	{ source: 'scripts/security/security-audit-provision.ts', out: 'audit-provision' },
	{ source: 'scripts/hooks/batch-guard.ts', out: 'batch-guard' },
	{ source: 'scripts/delegation/investigation-guard.ts', out: 'investigation-guard' },
	{ source: 'scripts/delegation/duplicate-read-guard.ts', out: 'duplicate-read-guard' },
]

function entry_point(bundle: HookBundle): { in: string; out: string } {
	return { in: path.join(PACKAGE_DIR, bundle.source), out: bundle.out }
}

function outfile_for(bundle: HookBundle): string {
	return path.join(OUT_DIR, `${bundle.out}.js`)
}

// The output directory is flat (every entry and chunk sits at its top level), so a file whose name
// this build did not emit is a leftover of an earlier one.
function prune_stale_outputs(out_directory: string, outputs: ReadonlyArray<string>): void {
	const live = new Set([...outputs.map((output) => path.basename(output)), STAMP_NAME])

	for (const name of readdirSync(out_directory)) {
		if (!live.has(name)) rmSync(path.join(out_directory, name), { recursive: true, force: true })
	}
}

// Every file the build loads is read here, so the stamp digests the exact bytes that were bundled —
// a source edited mid-build is recorded as what it was, and the next launch rebuilds it.
function source_recorder(sources: Map<string, Uint8Array>): Plugin {
	return {
		name: 'hook-source-recorder',
		setup(plugin_build: PluginBuild): void {
			plugin_build.onLoad({ filter: ANY_PATH, namespace: 'file' }, function load(args: OnLoadArgs) {
				const contents = readFileSync(args.path)

				sources.set(path.relative(PACKAGE_DIR, args.path), contents)

				return { contents, loader: 'default' }
			})
		},
	}
}

function is_chunk(file: OutputFile): boolean {
	return path.basename(file.path).startsWith(CHUNK_PREFIX)
}

// Shared chunks first, then the entries that import them: an entry swapped in before its chunks
// would fail to load in a hook launched at that moment.
function is_chunk_first(left: OutputFile, right: OutputFile): number {
	return Number(is_chunk(right)) - Number(is_chunk(left))
}

// Each file is written into a private staging directory and renamed into place, so a hook never
// reads a half-written bundle and two builds running side by side never write one file at once.
function place(staging: string, target: string, contents: Uint8Array | string): void {
	const temporary = path.join(staging, path.basename(target))

	writeFileSync(temporary, contents)
	renameSync(temporary, target)
}

function place_build(out_directory: string, files: ReadonlyArray<OutputFile>, stamp: string): void {
	mkdirSync(out_directory, { recursive: true })
	const staging = mkdtempSync(path.join(path.dirname(out_directory), STAGING_PREFIX))

	try {
		for (const file of files.toSorted(is_chunk_first)) place(staging, file.path, file.contents)
		prune_stale_outputs(
			out_directory,
			files.map((file) => file.path),
		)
		place(staging, path.join(out_directory, STAMP_NAME), stamp)
	} finally {
		rmSync(staging, { recursive: true, force: true })
	}
}

// With `splitting: true` every build emits freshly hashed `chunk-*.js` files, so without a cleanup
// the chunks of every earlier build pile up beside the live ones and ship in any local pack.
// The cleanup runs after the new files are in place rather than emptying
// the directory first: this checkout's own settings.json launches `node dist/hooks/<name>.js` on
// every tool call, and an emptied directory would make a hook launched mid-build fail to load and its
// guard fail open. The source digest is placed last (`hook-bundle-stamp.ts`), so a launch only reads
// the bundles as fresh once every one of them is in place.
async function build_hooks(out_directory: string = OUT_DIR): Promise<void> {
	const sources = new Map<string, Uint8Array>()
	const { outputFiles: files } = await build({
		absWorkingDir: PACKAGE_DIR,
		entryPoints: HOOK_BUNDLES.map((bundle) => entry_point(bundle)),
		outdir: out_directory,
		bundle: true,
		splitting: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		write: false,
		plugins: [source_recorder(sources)],
	})
	const stamp = hook_bundle_stamp.stamp_text(
		sources,
		files.map((file) => file.path),
	)

	place_build(out_directory, files, stamp)
}

async function main(): Promise<void> {
	try {
		await build_hooks()
		for (const bundle of HOOK_BUNDLES) console.info(`  ✔ ${outfile_for(bundle)} built`)
	} catch (error) {
		console.error(error_text.message_of(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export type { HookBundle }
export { build_hooks, HOOK_BUNDLES, OUT_DIR, outfile_for }
