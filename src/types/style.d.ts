// noinspection JSUnusedGlobalSymbols
declare module '*.module.scss' {
    const classes: Record<string, string>
    // noinspection JSUnusedGlobalSymbols
    export default classes
}

// Global constants injected by Vite at build time
declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string
declare const __COMPAT_MIN_SERVER__: string
