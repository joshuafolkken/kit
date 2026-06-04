import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sync } from './sync'

const TEST_DIR = path.join(tmpdir(), 'sync-deploy-vps-test')
const DEPLOY_VPS_DEST = path.join(TEST_DIR, 'dest', 'deploy-vps.yml')

const OLD_DEPLOY_VPS_CONTENT = `    script: |
      if ! command -v pnpm &> /dev/null; then
        npm install -g pnpm@10.24.0 || curl -fsSL https://get.pnpm.io/install.sh | sh -
      fi
`
const PNPM11_INSTALL = 'npm install -g pnpm@11.0.6'
const VERSION_CHECK_MARKER = '[ "$PNPM_MAJOR" -lt 11 ]'

beforeEach(() => {
	mkdirSync(path.join(TEST_DIR, 'dest'), { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync_deploy_vps', () => {
	it('does nothing when deploy-vps.yml does not exist', () => {
		sync.sync_deploy_vps(DEPLOY_VPS_DEST)

		expect(existsSync(DEPLOY_VPS_DEST)).toBe(false)
	})

	it('patches pnpm version and adds version check when file exists', () => {
		writeFileSync(DEPLOY_VPS_DEST, OLD_DEPLOY_VPS_CONTENT)
		sync.sync_deploy_vps(DEPLOY_VPS_DEST)

		const result = readFileSync(DEPLOY_VPS_DEST, 'utf8')

		expect(result).toContain(PNPM11_INSTALL)
		expect(result).toContain(VERSION_CHECK_MARKER)
	})

	it('logs unchanged when file already uses pnpm@11 with version check', () => {
		const already_patched = OLD_DEPLOY_VPS_CONTENT.replaceAll(
			'if ! command -v pnpm &> /dev/null; then',
			`PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")\n      if ! command -v pnpm &> /dev/null || ${VERSION_CHECK_MARKER}; then`,
		).replaceAll('pnpm@10.24.0', 'pnpm@11.0.6')
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => {
			/* suppress */
		})

		writeFileSync(DEPLOY_VPS_DEST, already_patched)
		sync.sync_deploy_vps(DEPLOY_VPS_DEST)

		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('unchanged'))
		expect(readFileSync(DEPLOY_VPS_DEST, 'utf8')).toBe(already_patched)
	})
})
