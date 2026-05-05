import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { create_playwright_config } from './base'

const CI_VAR = 'CI'
const DEV_PORT = 5173
const PREVIEW_PORT = 4173

describe('create_playwright_config', () => {
	beforeEach(() => {
		delete process.env[CI_VAR]
	})

	afterEach(() => {
		delete process.env[CI_VAR]
	})

	it('returns webServer pointing to dev_port in local mode', () => {
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.webServer).toMatchObject({ port: DEV_PORT, reuseExistingServer: true })
	})

	it('returns webServer pointing to preview_port in CI mode', () => {
		process.env[CI_VAR] = 'true'
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.webServer).toMatchObject({ port: PREVIEW_PORT, reuseExistingServer: false })
	})

	it('sets testDir to e2e and fullyParallel to true', () => {
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.testDir).toBe('e2e')
		expect(config.fullyParallel).toBe(true)
	})

	it('includes chromium project', () => {
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.projects).toHaveLength(1)
		expect(config.projects?.[0]).toMatchObject({ name: 'chromium' })
	})

	it('sets screenshot, video, trace to off in local mode', () => {
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.use).toMatchObject({ screenshot: 'off', video: 'off', trace: 'off' })
	})

	it('sets screenshot, video, trace to retain-on-failure or only-on-failure in CI mode', () => {
		process.env[CI_VAR] = 'true'
		const config = create_playwright_config({ dev_port: DEV_PORT, preview_port: PREVIEW_PORT })
		expect(config.use).toMatchObject({
			screenshot: 'only-on-failure',
			video: 'retain-on-failure',
			trace: 'retain-on-failure',
		})
	})
})
