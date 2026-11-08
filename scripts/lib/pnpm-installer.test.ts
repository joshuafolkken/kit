import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { pnpm_installer } from './pnpm-installer'

const INSTALLER = 'printf "%s" "$PNPM_VERSION" > "$EXECUTED"\n'
const SHA256 = '53d3ad6ef67d49d6951f3326bd3180e5c504c8f695bcdf73bb61ec7a4d4c9407'
const EXECUTABLE = 0o755
const CURL =
	'#!/bin/sh\n[ "$FAIL_DOWNLOAD" = yes ] && exit 1\nwhile [ "$1" != -o ]; do shift; done\ncp "$PAYLOAD" "$2"\n'
const ctx = { directory: '' }
const make_directory = temporary_directory()

function fixture_path(name: string): string {
	return path.join(ctx.directory, name)
}

function link_tool(name: string): void {
	const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' })

	symlinkSync(result.stdout.trim(), fixture_path(name))
}

// Substitute only the pinned digest: the generated download/verify/execute chain is unchanged.
function fixture_command(): string {
	return pnpm_installer
		.command()
		.replace(SHA256, () => createHash('sha256').update(INSTALLER).digest('hex'))
}

function run_installer(command: string, fail_download = 'no'): number | null {
	return spawnSync('sh', ['-c', `false || ${command}`], {
		env: {
			...process.env,
			PATH: ctx.directory,
			PAYLOAD: fixture_path('payload'),
			EXECUTED: fixture_path('executed'),
			FAIL_DOWNLOAD: fail_download,
		},
	}).status
}

beforeEach(() => {
	ctx.directory = make_directory('pnpm-installer-')
	writeFileSync(fixture_path('curl'), CURL, { mode: EXECUTABLE })
	writeFileSync(fixture_path('payload'), INSTALLER)
	for (const tool of ['mktemp', 'rm', 'cp', 'sh', 'shasum']) link_tool(tool)
})

describe('pnpm_installer.command', () => {
	it('pins the source, digest and exact pnpm version before execution', () => {
		const command = pnpm_installer.command()

		expect(command).toContain('/7c26e549143daf5cf072a38c428170ad8eccaf2d/install.sh -o')
		expect(command).toContain(SHA256)
		expect(command).toContain("curl --proto '=https' -fsSL")
		expect(command.indexOf('curl ')).toBeLessThan(command.indexOf('sha256sum -c -'))
		expect(command.indexOf('shasum -a 256 -c -')).toBeLessThan(
			command.indexOf('PNPM_VERSION=12.6.0 sh'),
		)
	})

	it('executes a verified download with the pinned version using shasum', () => {
		expect(run_installer(fixture_command())).toBe(0)
		expect(readFileSync(fixture_path('executed'), 'utf8')).toBe('12.6.0')
	})

	it('executes a verified download using sha256sum when available', () => {
		writeFileSync(fixture_path('sha256sum'), '#!/bin/sh\nexec shasum -a 256 "$@"\n', {
			mode: EXECUTABLE,
		})

		expect(run_installer(fixture_command())).toBe(0)
		expect(readFileSync(fixture_path('executed'), 'utf8')).toBe('12.6.0')
	})

	it('does not execute after a failed download, even in an npm fallback', () => {
		expect(run_installer(fixture_command(), 'yes')).not.toBe(0)
		expect(existsSync(fixture_path('executed'))).toBe(false)
	})

	it('does not execute a download whose digest differs', () => {
		writeFileSync(fixture_path('payload'), `${INSTALLER}# tampered\n`)

		expect(run_installer(fixture_command())).not.toBe(0)
		expect(existsSync(fixture_path('executed'))).toBe(false)
	})
})
