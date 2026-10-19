import react from '@vitejs/plugin-react'
import {execSync} from 'child_process'
import fs from 'fs'
import path from 'path'
import {defineConfig} from 'vite'
import {viteSingleFile} from 'vite-plugin-singlefile'

// Resolve the version from VERSION, git describe, a non-placeholder package version, or dev.
function getVersion(): string {
    if (process.env.VERSION) {
        return process.env.VERSION
    }

    try {
        const gitTag = execSync(
            'git describe --tags --exact-match 2>/dev/null || git describe --tags 2>/dev/null || echo ""',
            { encoding: 'utf8' },
        ).trim()
        if (gitTag) {
            return gitTag
        }
    } catch {
        // Git is unavailable or the repository has no tags.
    }

    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'))
        if (pkg.version && pkg.version !== '0.0.0') {
            return pkg.version
        }
    } catch {
        // package.json is unavailable or invalid.
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
                                    // Bump when the panel depends on newer management APIs.
                                    __COMPAT_MIN_SERVER__: JSON.stringify('8.0.23-aug.1'),
                                },
                                resolve: {
                                    alias: {
                                        '@': path.resolve(import.meta.dirname, './src'),
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
                                },
                            })
