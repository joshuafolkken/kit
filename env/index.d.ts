declare const environment_flags: {
	normalize_flag_value: (value: string) => string
	is_flag_enabled: (value: string | undefined) => boolean
	is_ci_enabled: (value: string | undefined) => boolean
}

export { environment_flags }
