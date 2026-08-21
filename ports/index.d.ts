type PortEnvironment = Record<string, string | undefined>

declare const ENV_FILE_NAME: string
declare const PORT_SEED_KEY: string

declare const ports: {
	load_environment_file: (directory?: string) => boolean
	resolve_seed: (environment?: PortEnvironment) => number
	resolve_development_port: (environment?: PortEnvironment) => number
	resolve_preview_port: (environment?: PortEnvironment) => number
}

export type { PortEnvironment }
export { ENV_FILE_NAME, PORT_SEED_KEY, ports }
