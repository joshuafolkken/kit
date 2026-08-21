type PortEnvironment = Record<string, string | undefined>

declare const PORT_SEED_KEY: string

declare const ports: {
	resolve_seed: (environment?: PortEnvironment) => number
	resolve_development_port: (environment?: PortEnvironment) => number
	resolve_preview_port: (environment?: PortEnvironment) => number
}

export type { PortEnvironment }
export { PORT_SEED_KEY, ports }
