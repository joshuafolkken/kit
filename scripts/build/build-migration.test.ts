import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { describe, expect, it } from 'vitest'
import { build_migration, MIGRATION_OUTFILE } from './build-migration'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const make_directory = temporary_directory()
const TIMEOUT = 120_000
const ENTRY = 'registry-migrate.mjs'
const USER_CONFIG = 'user.npmrc'

function pack_entry(root: string): string {
	execFileSync('pnpm', ['pack', '--pack-destination', root, '--config.ignore-scripts=true'], {
		cwd: ROOT,
		stdio: 'pipe',
		timeout: TIMEOUT,
	})
	const archive = readdirSync(root).find((file) => file.endsWith('.tgz')) ?? ''
	const entry = `package/dist/${ENTRY}`

	execFileSync('tar', ['-xzf', path.join(root, archive), '-C', root, entry])

	return readFileSync(path.join(root, entry), 'utf8')
}

function create_consumer(root: string, packed: string): string {
	const consumer = path.join(root, 'consumer')

	write_file(consumer, ENTRY, packed)
	write_file(consumer, '.npmrc', '@joshuafolkken:registry=https://unreachable.invalid\n')
	write_file(root, USER_CONFIG, '@joshuafolkken:registry=https://unreachable-user.invalid\n')

	return consumer
}

function run_entry(root: string, consumer: string): string {
	return execFileSync(process.execPath, [path.join(consumer, ENTRY), '--help'], {
		cwd: consumer,
		encoding: 'utf8',
		env: { ...process.env, NPM_CONFIG_USERCONFIG: path.join(root, USER_CONFIG) },
	})
}

describe('standalone migration distribution', () => {
	it(
		'runs the packed entry with no installed kit despite project and user mappings (ac-298942cf) (ac-a93c68e0)',
		async () => {
			const root = make_directory('packed-migration-')

			await build_migration()
			const packed = pack_entry(root)
			const result = run_entry(root, create_consumer(root, packed))

			expect(result).toContain('Usage: node registry-migrate.mjs')
			expect(readFileSync(path.join(root, USER_CONFIG), 'utf8')).toContain(
				'unreachable-user.invalid',
			)
			expect(readFileSync(MIGRATION_OUTFILE, 'utf8')).toBe(packed)
		},
		TIMEOUT,
	)
})
