import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it } from 'vitest'
import { claude_installer } from './claude-installer'

const VERSION = '2.1.318'
const X64_SHA256 = '708c77b204db30086ff6f1ed34577bda03e1be74ced80557cbf7b54249ebf0bd'
const ARM64_SHA256 = '53a0d7e219d7b0804ecba5dbc002745e89f786cc946d2de85a6470d5b2d1fb06'
const PAYLOAD =
	'#!/bin/sh\nprintf "%s" "$DISABLE_AUTOUPDATER" > "$EXECUTED"\necho "2.1.318 (Claude Code)"\n'
const CURL =
	'#!/bin/sh\necho "$4" > "$REQUESTED"\n[ "$FAIL_DOWNLOAD" = yes ] && exit 22\ncp "$PAYLOAD" "$6"\n'
const EXECUTABLE = 0o755
const ARM_ARCHITECTURE = 'aarch64'
const ARM_PLATFORM = 'linux-arm64'
const ctx = { directory: '' }
const make_directory = temporary_directory()

function fixture_path(name: string): string {
	return path.join(ctx.directory, name)
}

// Change only the expected digest; execute the real generated chain with fake download bytes.
function fixture_command(): string {
	const digest = createHash('sha256').update(PAYLOAD).digest('hex')

	return claude_installer
		.command()
		.replace(X64_SHA256, () => digest)
		.replace(ARM64_SHA256, () => digest)
}

function run_installer(architecture: string, fail_download = 'no'): number | null {
	return spawnSync('sh', ['-c', `false || ${fixture_command()}`], {
		env: {
			...process.env,
			PATH: `${ctx.directory}:${process.env['PATH'] ?? ''}`,
			HOME: ctx.directory,
			TMPDIR: ctx.directory,
			ARCHITECTURE: architecture,
			FAIL_DOWNLOAD: fail_download,
			PAYLOAD: fixture_path('payload'),
			EXECUTED: fixture_path('executed'),
			REQUESTED: fixture_path('requested'),
		},
	}).status
}

beforeEach(() => {
	ctx.directory = make_directory('claude installer ')
	writeFileSync(fixture_path('curl'), CURL, { mode: EXECUTABLE })
	writeFileSync(fixture_path('uname'), '#!/bin/sh\necho "$ARCHITECTURE"\n', { mode: EXECUTABLE })
	writeFileSync(fixture_path('payload'), PAYLOAD)
})

describe('claude_installer.command', () => {
	it('pins the first executable version and platform digests in the repository (ac-37e765e2)', () => {
		const command = claude_installer.command()

		expect(command).toContain(
			`https://downloads.claude.ai/claude-code-releases/${VERSION}/$platform/claude`,
		)
		expect(command).toContain(`platform=linux-x64; checksum=${X64_SHA256}`)
		expect(command).toContain(`platform=linux-arm64; checksum=${ARM64_SHA256}`)
		expect(command).not.toMatch(/latest|manifest|install\.sh/u)
		expect(command.indexOf('sha256sum -c -')).toBeLessThan(command.indexOf('install -m 755'))
	})

	it.each([
		['x86_64', 'linux-x64'],
		['amd64', 'linux-x64'],
		[ARM_ARCHITECTURE, ARM_PLATFORM],
		['arm64', ARM_PLATFORM],
	])(
		'installs and runs verified %s bytes with updates disabled (ac-176b1cac)',
		(architecture, platform) => {
			expect(run_installer(architecture)).toBe(0)
			expect(readFileSync(fixture_path('requested'), 'utf8').trim()).toBe(
				`https://downloads.claude.ai/claude-code-releases/${VERSION}/${platform}/claude`,
			)
			expect(readFileSync(fixture_path('executed'), 'utf8')).toBe('1')
		},
	)
})

describe('claude_installer.command failures', () => {
	it('refuses execution after download failure (ac-a9b5af9b)', () => {
		expect(run_installer('x86_64', 'yes')).not.toBe(0)
		expect(existsSync(fixture_path('executed'))).toBe(false)
	})

	it('refuses execution after a digest mismatch (ac-a9b5af9b)', () => {
		writeFileSync(fixture_path('payload'), `${PAYLOAD}# tampered\n`)

		expect(run_installer(ARM_ARCHITECTURE)).not.toBe(0)
		expect(existsSync(fixture_path('executed'))).toBe(false)
	})

	it('rejects unsupported architectures before downloading (ac-a9b5af9b)', () => {
		expect(run_installer('riscv64')).not.toBe(0)
		expect(existsSync(fixture_path('requested'))).toBe(false)
		expect(existsSync(fixture_path('executed'))).toBe(false)
	})
})
