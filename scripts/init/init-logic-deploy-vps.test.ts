import { describe, expect, it } from 'vitest'
import { init_logic_deploy_vps } from './init-logic-deploy-vps'

const PNPM10_INSTALL = 'npm install -g pnpm@10.24.0'
const PNPM11_INSTALL = 'npm install -g pnpm@11.0.6'
const PNPM12_INSTALL = 'npm install -g pnpm@12.6.0'
const OLD_IF_CHECK = 'if ! command -v pnpm &> /dev/null; then'
const NEW_IF_CHECK =
	'if [ "$PNPM_MAJOR" -lt 12 ] || { [ "$PNPM_MAJOR" -eq 12 ] && [ "$PNPM_MINOR" -lt 1 ]; }; then'
const VERSION_CHECK_LINE = 'PNPM_VERSION=$(pnpm --version 2>/dev/null || echo "0.0.0")'

const OLD_WORKFLOW_SCRIPT = `    script: |
      cd ~/app
      git pull
      if ! command -v pnpm &> /dev/null; then
        echo "Installing pnpm..."
        npm install -g pnpm@10.24.0 || curl -fsSL https://get.pnpm.io/install.sh | sh -
      fi
      pnpm install --frozen-lockfile
`

describe('patch_deploy_vps_pnpm — pnpm version update', () => {
	it('replaces pnpm@10 install with pnpm@12.6', () => {
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(OLD_WORKFLOW_SCRIPT)

		expect(result).toContain(PNPM12_INSTALL)
		expect(result).not.toContain(PNPM10_INSTALL)
	})

	it('upgrades pnpm 12.0 but preserves a newer pnpm 12 install', () => {
		const outdated = OLD_WORKFLOW_SCRIPT.replace(PNPM10_INSTALL, 'npm install -g pnpm@12.0.0')
		const newer = OLD_WORKFLOW_SCRIPT.replace(PNPM10_INSTALL, 'npm install -g pnpm@12.7.0')

		expect(init_logic_deploy_vps.patch_deploy_vps_pnpm(outdated)).toContain(PNPM12_INSTALL)
		expect(init_logic_deploy_vps.patch_deploy_vps_pnpm(newer)).toContain('pnpm@12.7.0')
	})

	it('returns content unchanged when no pnpm install command is present', () => {
		const content = 'name: Deploy\non:\n  push:\n'

		expect(init_logic_deploy_vps.patch_deploy_vps_pnpm(content)).toBe(content)
	})
})

describe('patch_deploy_vps_pnpm — version check insertion', () => {
	it('inserts version check before old if-condition', () => {
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(OLD_WORKFLOW_SCRIPT)

		expect(result).toContain(VERSION_CHECK_LINE)
		expect(result).toContain(NEW_IF_CHECK)
		expect(result).not.toContain(OLD_IF_CHECK)
	})

	it('preserves indentation of the if-condition line', () => {
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(OLD_WORKFLOW_SCRIPT)
		const lines = result.split('\n')
		const version_check_line = lines.find((line) => line.includes(VERSION_CHECK_LINE))
		const if_line = lines.find((line) => line.includes(NEW_IF_CHECK))

		expect(/^\s*/u.exec(version_check_line ?? '')?.[0]).toBe(/^\s*/u.exec(if_line ?? '')?.[0])
	})

	it('is idempotent when version check already present', () => {
		const first = init_logic_deploy_vps.patch_deploy_vps_pnpm(OLD_WORKFLOW_SCRIPT)
		const second = init_logic_deploy_vps.patch_deploy_vps_pnpm(first)

		expect(second).toBe(first)
	})
})

describe('patch_deploy_vps_pnpm — existing guards', () => {
	it('upgrades the old pnpm 11 guard without duplicating its version line', () => {
		const old_guard = OLD_WORKFLOW_SCRIPT.replace(
			OLD_IF_CHECK,
			`PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")\n      if ! command -v pnpm &> /dev/null || [ "$PNPM_MAJOR" -lt 11 ]; then`,
		).replace(PNPM10_INSTALL, () => PNPM11_INSTALL)
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(old_guard)

		expect(result).toContain(PNPM12_INSTALL)
		expect(result).toContain(NEW_IF_CHECK)
		expect(result).not.toContain('"$PNPM_MAJOR" -lt 11')
		expect(result.match(/PNPM_MAJOR=/gu)).toHaveLength(1)
	})

	it('preserves a custom guard and the version assignment it uses', () => {
		const custom_guard = OLD_WORKFLOW_SCRIPT.replace(
			OLD_IF_CHECK,
			`PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")\n      if [ "$PNPM_MAJOR" -lt 12 ]; then`,
		)
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(custom_guard)

		expect(result).toContain('PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1')
		expect(result).toContain('if [ "$PNPM_MAJOR" -lt 12 ]; then')
	})
})
