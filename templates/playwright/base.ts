import { defineConfig, devices } from '@playwright/test'

interface PlaywrightConfigOptions {
	dev_port: number
	preview_port: number
}

interface WebServerConfig {
	command: string
	port: number
	timeout: number
	reuseExistingServer: boolean
}

const CI_TIMEOUT = 15_000
const LOCAL_TIMEOUT = 25_000
const TEST_TIMEOUT = 10_000
const EXPECT_TIMEOUT = 5_000
const ACTION_TIMEOUT = 5_000
const NAVIGATION_TIMEOUT = 10_000
const CI_WORKERS = 2
const CI_RETRIES = 2
const VIEWPORT_WIDTH = 1_280
const VIEWPORT_HEIGHT = 720

function get_web_server_config(options: PlaywrightConfigOptions, is_ci: boolean): WebServerConfig {
	if (is_ci) {
		return {
			command: 'pnpm run preview',
			port: options.preview_port,
			timeout: CI_TIMEOUT,
			reuseExistingServer: false,
		}
	}
	return {
		command: 'pnpm run dev',
		port: options.dev_port,
		timeout: LOCAL_TIMEOUT,
		reuseExistingServer: true,
	}
}

function get_global_use_config(is_ci: boolean): {
	actionTimeout: number
	navigationTimeout: number
	screenshot: 'only-on-failure' | 'off'
	video: 'retain-on-failure' | 'off'
	trace: 'retain-on-failure' | 'off'
} {
	return {
		actionTimeout: ACTION_TIMEOUT,
		navigationTimeout: NAVIGATION_TIMEOUT,
		screenshot: is_ci ? 'only-on-failure' : 'off',
		video: is_ci ? 'retain-on-failure' : 'off',
		trace: is_ci ? 'retain-on-failure' : 'off',
	}
}

function create_playwright_config(
	options: PlaywrightConfigOptions,
): ReturnType<typeof defineConfig> {
	const is_ci = Boolean(process.env['CI'])
	return defineConfig({
		webServer: get_web_server_config(options, is_ci),
		testDir: 'e2e',
		fullyParallel: true,
		...(is_ci ? { workers: CI_WORKERS } : {}),
		retries: is_ci ? CI_RETRIES : 0,
		timeout: TEST_TIMEOUT,
		expect: { timeout: EXPECT_TIMEOUT },
		projects: [
			{
				name: 'chromium',
				use: {
					...devices['Desktop Chrome'],
					viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
					launchOptions: {
						args: ['--disable-dev-shm-usage', '--disable-gpu', ...(is_ci ? ['--no-sandbox'] : [])],
					},
				},
			},
		],
		reporter: is_ci ? [['html'], ['github']] : [['html'], ['list']],
		use: get_global_use_config(is_ci),
	})
}

export { create_playwright_config }
