import { describe, expect, it } from 'vitest'
import { init_logic_deploy_vps } from './init-logic-deploy-vps'

const PNPM10_INSTALL = 'npm install -g pnpm@10.24.0'
const PNPM11_INSTALL = 'npm install -g pnpm@11.0.6'
const OLD_IF_CHECK = 'if ! command -v pnpm &> /dev/null; then'
const NEW_IF_CHECK = 'if ! command -v pnpm &> /dev/null || [ "$PNPM_MAJOR" -lt 11 ]; then'
const VERSION_CHECK_LINE = 'PNPM_MAJOR=$(pnpm --version 2>/dev/null | cut -d. -f1 || echo "0")'

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
	it('replaces pnpm@10 install with pnpm@11', () => {
		const result = init_logic_deploy_vps.patch_deploy_vps_pnpm(OLD_WORKFLOW_SCRIPT)

		expect(result).toContain(PNPM11_INSTALL)
		expect(result).not.toContain(PNPM10_INSTALL)
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
