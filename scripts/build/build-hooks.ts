#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

// The three settings.json hooks, the Codex input adapter, and the two guards `pretool-guard`
// composes: `batch-guard` and `investigation-guard` each self-invoke, so they must be their own
// entries to keep their `import.meta.url` out of `pretool-guard`'s file. `delivered-rules` (the third
// guard) has no self-invoke, so it stays inlined.
const HOOK_BUNDLES: ReadonlyArray<HookBundle> = [
	{ source: 'scripts/hooks/codex-hook-adapter.ts', out: 'codex-hook-adapter' },
	{ source: 'scripts/hooks/pretool-guard.ts', out: 'pretool-guard' },
	{ source: 'scripts/hooks/format-edited-file.ts', out: 'format-edited' },
	{ source: 'scripts/josh/session-language-cli.ts', out: 'session-lang' },
	{ source: 'scripts/hooks/batch-guard.ts', out: 'batch-guard' },
	{ source: 'scripts/delegation/investigation-guard.ts', out: 'investigation-guard' },
]

function entry_point(bundle: HookBundle): { in: string; out: string } {
	return { in: path.join(PACKAGE_DIR, bundle.source), out: bundle.out }
}

function outfile_for(bundle: HookBundle): string {
	return path.join(OUT_DIR, `${bundle.out}.js`)
}

async function build_hooks(): Promise<void> {
	await build({
		entryPoints: HOOK_BUNDLES.map((bundle) => entry_point(bundle)),
		outdir: OUT_DIR,
		bundle: true,
		splitting: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
	})
}

async function main(): Promise<void> {
	try {
		await build_hooks()
		for (const bundle of HOOK_BUNDLES) console.info(`  ✔ ${outfile_for(bundle)} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export type { HookBundle }
export { build_hooks, HOOK_BUNDLES, OUT_DIR, outfile_for }
