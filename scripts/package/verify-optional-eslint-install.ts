import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { kit_development_versions } from '#scripts/init/kit-development-versions'
import { PACKAGE_JSON, package_manifest } from '#scripts/lib/package-manifest'
import { execaSync } from 'execa'
import { z } from 'zod'

const root = process.cwd()
const scratch = mkdtempSync(path.join(os.tmpdir(), 'kit-eslint-install-'))
const IGNORE_SCRIPTS = '--ignore-scripts'
const version_map_schema = z.record(z.string(), z.string())
const manifest = package_manifest.read_manifest(
	root,
	z.object({ peerDependencies: version_map_schema }),
)
const eslint_peers = Object.keys(manifest.peerDependencies).filter((name) =>
	/^(?:@eslint\/|@stylistic\/|eslint|globals$|typescript)/u.test(name),
)

try {
	const { stdout } = execaSync(
		'pnpm',
		['pack', IGNORE_SCRIPTS, '--pack-destination', scratch, '--json'],
		{ cwd: root },
	)
	const { filename } = JSON.parse(stdout) as { filename: string }
	const probe = path.join(scratch, 'consumer.mjs')
	const tarball = path.resolve(scratch, filename)

	writeFileSync(
		path.join(scratch, '.npmrc'),
		'auto-install-peers=false\nstrict-peer-dependencies=true\n',
	)
	writeFileSync(path.join(scratch, PACKAGE_JSON), '{"private":true,"type":"module"}\n')
	// The versions `josh init` gives a consumer, so the check installs what a consumer installs.
	const peer_specs = Object.entries(kit_development_versions.versions_of(eslint_peers)).map(
		([name, version]) => `${name}@${version}`,
	)

	execaSync('pnpm', ['--dir', scratch, 'add', IGNORE_SCRIPTS, tarball, ...peer_specs], {
		cwd: root,
		stdio: 'inherit',
	})
	writeFileSync(path.join(scratch, '.gitignore'), '')
	writeFileSync(
		probe,
		`import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'
import { ESLint } from 'eslint'
const config = create_vanilla_config({ gitignore_path: new URL('./.gitignore', import.meta.url), tsconfig_root_dir: process.cwd() })
const lint = new ESLint({ cwd: process.cwd(), overrideConfigFile: true, overrideConfig: config })
const [result] = await lint.lintText('var foo = 1', { filePath: 'probe.js' })
if (result.fatalErrorCount !== 0 || !result.messages.some((message) => message.ruleId === 'no-var')) process.exit(1)
`,
	)
	execaSync(process.execPath, [probe], { cwd: scratch, stdio: 'inherit' })
	console.info(
		'Packed kit installs with explicit ESLint peers and its public config lints successfully.',
	)
} finally {
	rmSync(scratch, { recursive: true, force: true })
}
