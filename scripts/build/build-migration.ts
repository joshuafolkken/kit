import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MIGRATION_OUTFILE = path.join(ROOT, 'dist', 'registry-migrate.mjs')

// No installed kit, package.json imports, or external npm dependencies are needed by this entry.
async function build_migration(outfile: string = MIGRATION_OUTFILE): Promise<string> {
	await build({
		entryPoints: [path.join(ROOT, 'scripts', 'registry-migration', 'migrate-cli.ts')],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		banner: {
			js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
		},
	})

	return outfile
}

export { build_migration, MIGRATION_OUTFILE }
