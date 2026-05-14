import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Get version from environment, git tag, or package.json
function getVersion(): string {
    // 1. Environment variable (set by GitHub Actions)
    if (process.env.VERSION) {
        return process.env.VERSION
    }

    // 2. Try git tag
    try {
        const gitTag = execSync(
            'git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo ""',
            { encoding: 'utf8' }
        ).trim()
        if (gitTag) {
            return gitTag
        }
    } catch {
        // Git not available or no tags
    }

    // 3. Fall back to package.json version
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'))
        if (pkg.version && pkg.version !== '0.0.0') {
            return pkg.version
        }
    } catch {
        // package.json not readable
    }

    return 'dev'
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        viteSingleFile({
            removeViteModuleLoader: true,
        }),
    ],
    define: {
        __APP_VERSION__: JSON.stringify(getVersion()),
        __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
        // Lowest server (CPA) build the panel can talk to.
        // Bump alongside API-breaking changes so the VersionCompatBanner
        // warns operators running stale backends.
        __COMPAT_MIN_SERVER__: JSON.stringify('6.9.0-aug.1'),
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    css: {
        modules: {
            localsConvention: 'camelCase',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
        },
        preprocessorOptions: {
            scss: {
                additionalData: `@use "@/styles/variables.scss" as *;`,
            },
        },
    },
    build: {
        target: 'es2020',
        outDir: 'dist',
        assetsInlineLimit: 100000000,
        chunkSizeWarningLimit: 100000000,
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
                manualChunks: undefined,
            },
        },
    },
})
