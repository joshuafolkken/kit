#!/usr/bin/env tsx
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { build } from 'esbuild'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')

// Each Claude Code hook is bundled to its own `dist/hooks/<name>.js`, so a consumer (and kit itself)
// invokes `node dist/hooks/<name>.js` directly — no `pnpm` launch and no `tsx` re-spawn from the
// `dist/josh.js` dispatcher (joshuafolkken/kit#2023).
//
// **`splitting: true` is load-bearing, not an optimization.** Every hook module decides whether to
// run its main from `process.argv[1] === fileURLToPath(import.meta.url)`. A single-file bundle would
// collapse every imported module's `import.meta.url` to the one output path, so a call to
// `node dist/hooks/pretool-guard.js` would fire the self-invoke of `batch-guard` and
// `investigation-guard` too — each reads stdin, and the second read gets an empty payload. Code
// splitting keeps every entry in its own file with its own `import.meta.url`, so an imported guard's
// `import.meta.url` never equals `argv[1]` and only the file actually launched runs its main.
//
// `packages: 'external'` keeps bare dependencies as runtime imports the consumer resolves from kit's
// node_modules, exactly as the library bundles do, while kit's internal `#scripts/*` graph is inlined.
// No shebang banner is added: unlike `dist/josh.js` (the `bin.josh` entry, executed directly), a hook
// bundle is always launched as `node <path>`.
interface HookBundle {
	source: string
	out: string
}

// The three settings.json hooks, the Codex input adapter, and the three guards `pretool-guard`
// composes: `batch-guard`, `investigation-guard` and `duplicate-read-guard` each self-invoke, so they
// must be their own entries to keep their `import.meta.url` out of `pretool-guard`'s file.
// `delivered-rules` (the fourth guard) has no self-invoke, so it stays inlined.
const HOOK_BUNDLES: ReadonlyArray<HookBundle> = [
	{ source: 'scripts/hooks/codex-hook-adapter.ts', out: 'codex-hook-adapter' },
	{ source: 'scripts/hooks/pretool-guard.ts', out: 'pretool-guard' },
	{ source: 'scripts/hooks/stop-guard.ts', out: 'stop-guard' },
	{ source: 'scripts/hooks/format-edited-file.ts', out: 'format-edited' },
	{ source: 'scripts/josh/session-language-cli.ts', out: 'session-lang' },
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
	const live = new Set(outputs.map((output) => path.basename(output)))

	for (const name of readdirSync(out_directory)) {
		if (!live.has(name)) rmSync(path.join(out_directory, name), { recursive: true, force: true })
	}
}

// With `splitting: true` every build emits freshly hashed `chunk-*.js` files, so without a cleanup
// the chunks of every earlier build pile up beside the live ones and ship in any local pack
// (joshuafolkken/kit#2885). The cleanup runs after the build rather than emptying the directory
// first: this checkout's own settings.json launches `node dist/hooks/<name>.js` on every tool call,
// and an emptied directory would make a hook launched mid-build fail to load and its guard fail open.
async function build_hooks(out_directory: string = OUT_DIR): Promise<void> {
	const { metafile } = await build({
		entryPoints: HOOK_BUNDLES.map((bundle) => entry_point(bundle)),
		outdir: out_directory,
		bundle: true,
		splitting: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		metafile: true,
	})

	prune_stale_outputs(out_directory, Object.keys(metafile.outputs))
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
