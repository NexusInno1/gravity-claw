import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        setupFiles: ["src/__tests__/setup.ts"],
        // Disable timeout for slow tests (API mocks can be slow to set up)
        testTimeout: 10_000,
    },
});
