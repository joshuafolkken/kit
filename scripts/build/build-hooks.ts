import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { toolchain_inputs } from '#scripts/gate/toolchain-inputs'
import { atomic_write } from '#scripts/lib/atomic-write'
import {
	build,
	type OnLoadArgs,
	type OnResolveArgs,
	type OutputFile,
	type Plugin,
	type PluginBuild,
} from 'esbuild'

const BUILD_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.join(path.dirname(BUILD_SCRIPT), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const { STAMP_NAME } = hook_bundle_stamp
const CHUNK_PREFIX = 'chunk-'
const STAGING_PREFIX = '.hooks-staging-'
// esbuild compiles a plugin filter as a Go regexp, which rejects the `u` flag.
// eslint-disable-next-line require-unicode-regexp
const ANY_PATH = /.*/
// A bare specifier: not relative, absolute, a `#scripts/*` subpath import or a `node:` built-in.
// eslint-disable-next-line require-unicode-regexp
const BARE_SPECIFIER = /^[^./#]/
const NODE_BUILTIN_PREFIX = 'node:'
const SCOPE_PREFIX = '@'
const SCOPED_NAME_SEGMENTS = 2
const NODE_MODULES_SEGMENT = `${path.sep}node_modules${path.sep}`
const INLINED_PACKAGES: ReadonlySet<string> = new Set(['execa', 'js-yaml', 'semver', 'zod'])

// Each Claude Code hook is bundled to its own `dist/hooks/<name>.js`, so a consumer (and kit itself)
// invokes `node dist/hooks/<name>.js` directly — no `pnpm` launch and no `tsx` re-spawn from the
// `dist/josh.js` dispatcher.
//
// **`splitting: true` is load-bearing, not an optimization.** Every hook module decides whether to
// run its main from `process.argv[1] === fileURLToPath(import.meta.url)`. A single-file bundle would
// collapse every imported module's `import.meta.url` to the one output path, so a call to one hook
// would fire the self-invoke of every other entry it carries — each reads stdin, and the second read
// gets an empty payload. Code splitting keeps every entry in its own file with its own
// `import.meta.url`, so only the file actually launched runs its main. The guards `pretool-guard`
// composes carry no self-invoke: theirs live in `*-main.ts` entries no module imports.
//
// **The flip side: an entry another entry imports loses its main**. Splitting
// moves a module two entries share into a chunk, so a launched hook whose own module is imported
// elsewhere becomes a re-export stub that runs nothing. Each launched hook is therefore a `*-cli.ts`
// file holding only the self-invoke, which no other module imports.
//
// Kit's internal `#scripts/*` graph is inlined. **The light dependencies every hook launch loads are
// inlined too** (`INLINED_PACKAGES`, with whatever they import): resolving and loading their module
// graphs file by file from node_modules was most of a bundle's import time on every tool call
// (joshuafolkken/kit#5641). Every other bare dependency stays a runtime import the consumer resolves
// from kit's node_modules, exactly as the library bundles do — `typescript` alone would grow the
// bundles tenfold. No shebang banner is added: unlike `dist/josh.js` (the `bin.josh` entry, executed directly), a hook
// bundle is always launched as `node <path>`.
interface HookBundle {
	source: string
	out: string
}

// The settings.json hooks (the session-start audit provisioner among them) and the Codex input
// adapter — every hook a hook config launches, and nothing else.
const HOOK_BUNDLES: ReadonlyArray<HookBundle> = [
	{ source: 'scripts/hooks/codex-hook-adapter.ts', out: 'codex-hook-adapter' },
	{ source: 'scripts/hooks/pretool-guard-cli.ts', out: 'pretool-guard' },
	{ source: 'scripts/hooks/stop-guard.ts', out: 'stop-guard' },
	{ source: 'scripts/hooks/format-edited-cli.ts', out: 'format-edited' },
	{ source: 'scripts/josh/session-language-main.ts', out: 'session-lang' },
	{ source: 'scripts/security/security-audit-provision-main.ts', out: 'audit-provision' },
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

// **A module inlined into an entry keeps no self-invoke.** Its `import.meta.url` collapses to the
// entry's output path, so its guard would match `argv[1]` and its main would run beside the hook's:
// `stop-guard` ran `josh run:hold`'s, `josh notify`'s and `josh run:tidy`'s on every stop, and their
// stdout ahead of the envelope made the harness drop the refusal (joshuafolkken/kit#4123). Only the
// launched entry runs a main, so every other module's guard is built as `false`.
const SELF_INVOKE_GUARD = 'process.argv[1] === fileURLToPath(import.meta.url)'

function loaded_contents(contents: Uint8Array, is_entry: boolean): string {
	const source = Buffer.from(contents).toString('utf8')

	return is_entry ? source : source.replaceAll(SELF_INVOKE_GUARD, 'false')
}

function is_dependency_file(file_path: string): boolean {
	return file_path.includes(NODE_MODULES_SEGMENT)
}

function package_name(specifier: string): string {
	const segments = specifier.split('/')
	const length = specifier.startsWith(SCOPE_PREFIX) ? SCOPED_NAME_SEGMENTS : 1

	return segments.slice(0, length).join('/')
}

// An import inside node_modules belongs to an inlined package's graph — an external package is never
// loaded — so it is inlined with it.
function is_external(args: OnResolveArgs): boolean {
	if (args.path.startsWith(NODE_BUILTIN_PREFIX)) return true

	return !INLINED_PACKAGES.has(package_name(args.path)) && !is_dependency_file(args.importer)
}

function dependency_boundary(): Plugin {
	return {
		name: 'hook-dependency-boundary',
		setup(plugin_build: PluginBuild): void {
			plugin_build.onResolve({ filter: BARE_SPECIFIER }, function resolve(args: OnResolveArgs) {
				return is_external(args) ? { path: args.path, external: true } : undefined
			})
		},
	}
}

function record(sources: Map<string, Uint8Array>, file_path: string, contents: Uint8Array): void {
	if (!is_dependency_file(file_path)) sources.set(path.relative(PACKAGE_DIR, file_path), contents)
}

// Every first-party file the build loads is read here, so the stamp digests the exact bytes that were
// bundled — a source edited mid-build is recorded as what it was, and the next launch rebuilds it. An
// inlined dependency is loaded as esbuild reads it and left out of the record: the lockfile and pnpm's
// install record among the toolchain inputs already change with it, and every recorded input is
// stat-ed on every hook launch.
function source_recorder(sources: Map<string, Uint8Array>, entries: ReadonlySet<string>): Plugin {
	return {
		name: 'hook-source-recorder',
		setup(plugin_build: PluginBuild): void {
			plugin_build.onLoad({ filter: ANY_PATH, namespace: 'file' }, function load(args: OnLoadArgs) {
				const contents = readFileSync(args.path)

				record(sources, args.path, contents)

				return { contents: loaded_contents(contents, entries.has(args.path)), loader: 'default' }
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
	atomic_write.replace_file(target, contents, { staging_directory: staging })
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
//
// This script is an input too: it rewrites what it loads, so an edit to it changes the bundles while
// every bundled source stays byte-identical. So is the toolchain (`toolchain-inputs.ts`): the manifest
// maps the `#scripts/*` imports esbuild resolves, and the lockfile pins esbuild itself.
function build_inputs(): Map<string, Uint8Array> {
	const toolchain = toolchain_inputs.paths(PACKAGE_DIR)

	return new Map<string, Uint8Array>([
		[path.relative(PACKAGE_DIR, BUILD_SCRIPT), readFileSync(BUILD_SCRIPT)],
		...toolchain.map((input) => [input, readFileSync(path.join(PACKAGE_DIR, input))] as const),
	])
}

async function build_hooks(out_directory: string = OUT_DIR): Promise<void> {
	const sources = build_inputs()
	const entry_points = HOOK_BUNDLES.map((bundle) => entry_point(bundle))
	const entries = new Set(entry_points.map((entry) => entry.in))
	const { outputFiles: files } = await build({
		absWorkingDir: PACKAGE_DIR,
		entryPoints: entry_points,
		outdir: out_directory,
		bundle: true,
		splitting: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		write: false,
		plugins: [dependency_boundary(), source_recorder(sources, entries)],
	})
	const stamp = hook_bundle_stamp.stamp_text(
		sources,
		files.map((file) => file.path),
	)

	place_build(out_directory, files, stamp)
}

export type { HookBundle }
export { build_hooks, HOOK_BUNDLES, INLINED_PACKAGES, OUT_DIR, outfile_for, STAGING_PREFIX }
