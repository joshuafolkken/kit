import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execaSync } from 'execa'

const root = process.cwd()
const scratch = mkdtempSync(path.join(os.tmpdir(), 'kit-eslint-install-'))
const PACKAGE_JSON = 'package.json'
const IGNORE_SCRIPTS = '--ignore-scripts'
const manifest = JSON.parse(readFileSync(path.join(root, PACKAGE_JSON), 'utf8')) as {
	devDependencies: Record<string, string>
	peerDependencies: Record<string, string>
}
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
	const peer_specs = eslint_peers.map((name) => {
		const version = manifest.devDependencies[name]

		if (version === undefined) throw new Error(`Missing development dependency for ${name}`)

		return `${name}@${version}`
	})

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
