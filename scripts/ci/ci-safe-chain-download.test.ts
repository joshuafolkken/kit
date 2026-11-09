import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const make_directory = temporary_directory()
const INSTALLER = '#!/bin/sh\nset -e\ncurl binary\necho installed\n'
const CURL = `#!/bin/sh
set -e
cat "$CURL_HOME/.curlrc" >> "$RUNNER_TEMP/settings"
if [ "$1" = binary ]; then
  exit "$BINARY_STATUS"
fi
while [ "$1" != -o ]; do shift; done
cp "$RUNNER_TEMP/source" "$2"
`
const BINARY_CALLS = 'binary-calls'
const BINARY = `#!/bin/sh\necho "$1" >> "$RUNNER_TEMP/${BINARY_CALLS}"\n`
const FOREIGN_INSTALLER = 'different installer'
const RETRY_SETTINGS = 'retry = 3\nretry-delay = 2\nretry-max-time = 60\n'
const EXECUTABLE = 0o755

function setup(): string {
	const directory = make_directory('safe-chain-download-')

	writeFileSync(path.join(directory, 'source'), INSTALLER)
	writeFileSync(path.join(directory, 'curl'), CURL, { mode: EXECUTABLE })

	return directory
}

// What `actions/cache` restores into HOME: the installer and the binary it fetched.
function restore_cache(directory: string): void {
	const installer_directory = path.join(directory, '.safe-chain-installer')
	const binary_directory = path.join(directory, '.safe-chain', 'bin')

	mkdirSync(installer_directory, { recursive: true })
	mkdirSync(binary_directory, { recursive: true })
	writeFileSync(path.join(installer_directory, 'install-safe-chain.sh'), INSTALLER)
	writeFileSync(path.join(binary_directory, 'safe-chain'), BINARY, { mode: EXECUTABLE })
}

function run_setup(
	directory: string,
	digest: string,
	binary_status: string,
	cache_hit = '',
): number | null {
	const step = ci_yml_fixture
		.load_action(ci_yml_fixture.SETUP_PNPM_ACTION)
		.runs.steps.find((candidate) => candidate.name === 'Setup safe-chain')

	return spawnSync('bash', ['-eo', 'pipefail', '-c', step?.run ?? 'exit 1'], {
		env: {
			...process.env,
			PATH: `${directory}:${process.env['PATH'] ?? ''}`,
			HOME: directory,
			RUNNER_TEMP: directory,
			SAFE_CHAIN_CACHE_HIT: cache_hit,
			SAFE_CHAIN_INSTALLER_VERSION: 'test',
			SAFE_CHAIN_INSTALLER_SHA256: digest,
			BINARY_STATUS: binary_status,
		},
	}).status
}

it('passes bounded download retries to both the installer and its binary fetch', () => {
	const directory = setup()
	const digest = createHash('sha256').update(INSTALLER).digest('hex')

	expect(run_setup(directory, digest, '0')).toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS.repeat(2))
})

it('stops before running an installer whose hash does not match', () => {
	const directory = setup()
	const digest = createHash('sha256').update(FOREIGN_INSTALLER).digest('hex')

	expect(run_setup(directory, digest, '0')).not.toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS)
})

it('fails setup when the binary download still fails after curl retries', () => {
	const directory = setup()
	const digest = createHash('sha256').update(INSTALLER).digest('hex')

	expect(run_setup(directory, digest, '22')).not.toBe(0)
	expect(readFileSync(path.join(directory, 'settings'), 'utf8')).toBe(RETRY_SETTINGS.repeat(2))
})

// joshuafolkken/kit#6833: a GitHub Releases outage turned every job red before its tests.
it('sets the restored binary up for CI without reaching GitHub Releases', () => {
	const directory = setup()
	const digest = createHash('sha256').update(INSTALLER).digest('hex')

	restore_cache(directory)

	expect(run_setup(directory, digest, '22', 'true')).toBe(0)
	expect(existsSync(path.join(directory, 'settings'))).toBe(false)
	expect(readFileSync(path.join(directory, BINARY_CALLS), 'utf8')).toBe('setup-ci\n')
})

it('stops before setting up a restored binary whose installer hash does not match', () => {
	const directory = setup()
	const digest = createHash('sha256').update(FOREIGN_INSTALLER).digest('hex')

	restore_cache(directory)

	expect(run_setup(directory, digest, '0', 'true')).not.toBe(0)
	expect(existsSync(path.join(directory, BINARY_CALLS))).toBe(false)
})
