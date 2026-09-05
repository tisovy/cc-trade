// @vitest-environment node

import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const readProjectFile = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const source = readProjectFile('.github/workflows/ci.yml');
const workflow = load(source);
const job = workflow.jobs.verification;
const manifest = JSON.parse(readProjectFile('package.json'));
const lock = JSON.parse(readProjectFile('package-lock.json'));

describe('continuous verification workflow', () => {
    it('runs every main push and offers main-only manual verification', () => {
        expect(workflow.name).toBe('CI');
        expect(workflow.on).toEqual({ push: { branches: ['main'] }, workflow_dispatch: null });
        expect(job.if).toBe("github.ref == 'refs/heads/main'");
        expect(Object.keys(workflow.jobs)).toEqual(['verification']);
        expect(job.name).toBe('Linux verification');
    });

    it('bounds hosted execution and cancels only superseded workflow/ref runs', () => {
        expect(job['runs-on']).toBe('ubuntu-24.04');
        expect(job['timeout-minutes']).toBe(25);
        expect(workflow.concurrency).toEqual({
            group: '${{ github.workflow }}-${{ github.ref }}',
            'cancel-in-progress': true,
        });
        expect(job.defaults).toEqual({ run: { shell: 'bash' } });
    });

    it('keeps workflow authority read-only without hidden job-level overrides', () => {
        expect(workflow.permissions).toEqual({ contents: 'read' });
        expect(Object.keys(workflow).sort()).toEqual([
            'concurrency', 'jobs', 'name', 'on', 'permissions',
        ]);
        expect(Object.keys(job).sort()).toEqual([
            'defaults', 'env', 'if', 'name', 'runs-on', 'steps', 'timeout-minutes',
        ]);
        expect(source).not.toMatch(/\$\{\{\s*(?:secrets|vars)\b/);
    });

    it('uses only reviewed immutable actions without persisted credentials or caches', () => {
        expect(job.steps.filter(step => step.uses)).toEqual([
            {
                name: 'Check out the triggering revision',
                uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
                with: { 'persist-credentials': false },
            },
            {
                name: 'Set up the repository Node version',
                uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
                with: { 'node-version-file': '.nvmrc', 'package-manager-cache': false },
            },
        ]);
        expect(readProjectFile('.nvmrc').trim()).toMatch(/^24\.\d+\.\d+$/);
    });

    it('keeps normal production composition and account/analytics inputs empty', () => {
        expect(job.env).toEqual({
            CI: 'true',
            BUILD_MODE: '',
            VITE_DEV_SERVER_URL: '',
            ELECTRON_OPEN_DEVTOOLS: 'false',
            BK: '', BS: '', BFK: '', BFS: '',
            ANALYTICS_URL: '', ANALYTICS_BASE_URL: '', ANALYTICS_KEY: '', ANALYTICS_SECRET: '',
            CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        });
    });

    it('installs before verifying and packages only after the aggregate succeeds', () => {
        expect(job.steps.map(step => step.run ?? step.uses)).toEqual([
            'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
            'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
            'node --version\nnpm --version\n',
            'npm ci --no-audit --no-fund',
            'npm run test:all',
            'npm run dist -- --linux --x64 --dir --publish never',
        ]);
        for (const step of job.steps) {
            // No if/continue-on-error, credential override, alternate shell,
            // working directory or post-failure publication hidden in a step.
            expect(Object.keys(step).sort()).toEqual(
                step.uses ? ['name', 'uses', 'with'] : ['name', 'run'],
            );
        }
    });

    it('retains the full aggregate instead of a CI-only subset', () => {
        expect(manifest.scripts['test:all'].split(' && ')).toEqual([
            'npm run check:dependency-baseline',
            'npm run test',
            'npm run lint',
            'npm run build',
            'npm run check:circular',
            'npm run check:runtime-mock',
            'npm run check:futures-production',
            'npm run check:command-path',
        ]);
        expect(manifest.scripts.test).toBe('vitest run');
    });

    it('packages a fresh build and inspects the actual ASAR with the renderer inventory', () => {
        expect(manifest.scripts.predist).toBe('npm run build');
        expect(manifest.scripts.dist).toBe('electron-builder');
        expect(manifest.scripts.prebuild).toBe('npm run clean:build');
        expect(manifest.scripts.postbuild).toBe('npm run check:electron-build-artifacts');
        expect(manifest.build.asar).toBe(true);
        expect(manifest.build.afterPack).toBe('./scripts/check-packaged-app.mjs');
        // The real archive/renderer fixture lives in packaged-app-contract.test.mjs.
    });

    it('declares its YAML parser directly and agrees with the frozen install contract', () => {
        expect(manifest.devDependencies['js-yaml']).toBe('4.3.2');
        expect(lock.packages[''].devDependencies).toEqual(manifest.devDependencies);
        expect(lock.packages['node_modules/js-yaml'].version).toBe('4.3.2');
        expect(manifest.dependencies).not.toHaveProperty('js-yaml');
    });
});
