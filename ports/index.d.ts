type PortEnvironment = Record<string, string | undefined>

declare const ENV_FILE_NAME: string
declare const LANE_SEAT_KEY: string
declare const PORT_SEED_KEY: string
declare const PROJECT_ENVIRONMENT_KEYS: ReadonlySet<string>

declare const ports: {
	load_environment_file: (directory?: string) => boolean
	resolve_seed: (environment?: PortEnvironment) => number
	resolve_lane: (environment?: PortEnvironment) => number
	resolve_development_port: (environment?: PortEnvironment) => number
	resolve_preview_port: (environment?: PortEnvironment) => number
}

export type { PortEnvironment }
export { ENV_FILE_NAME, LANE_SEAT_KEY, PORT_SEED_KEY, PROJECT_ENVIRONMENT_KEYS, ports }
