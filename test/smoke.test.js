// Smoke tests: exercise the built CLI end to end.
// Run after `npm run build` (the `test` script does this automatically).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'x-one-smoke-'));
}

describe('CLI boots', () => {
  test('--version prints the package version', () => {
    const result = runCli(['--version'], process.cwd());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0\.1\.0/);
  });

  test('--help lists the create, dev and build commands', () => {
    const result = runCli(['--help'], process.cwd());
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /create/);
    assert.match(result.stdout, /dev/);
    assert.match(result.stdout, /build/);
  });
});

describe('create scaffolds each template', () => {
  const expectedFiles = {
    react: ['vite.config.ts', 'index.html', 'src/main.tsx', 'src/App.tsx'],
    nextjs: ['next.config.mjs', 'app/layout.tsx', 'app/page.tsx'],
    vite: ['vite.config.ts', 'index.html', 'src/main.ts', 'src/counter.ts'],
  };

  for (const [template, files] of Object.entries(expectedFiles)) {
    test(`template: ${template}`, () => {
      const dir = makeTempDir();
      try {
        const name = `smoke-${template}`;
        const result = runCli(
          ['create', name, '--template', template, '--skip-git'],
          dir,
        );
        assert.equal(result.status, 0, result.stderr || result.stdout);

        const projectDir = join(dir, name);
        const pkgPath = join(projectDir, 'package.json');
        assert.ok(existsSync(pkgPath), 'package.json was not generated');

        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        assert.equal(pkg.name, name);
        assert.ok(pkg.scripts?.dev, 'package.json is missing a dev script');
        assert.ok(pkg.scripts?.build, 'package.json is missing a build script');

        assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
        assert.ok(existsSync(join(projectDir, 'README.md')), 'README.md missing');
        assert.ok(existsSync(join(projectDir, '.gitignore')), '.gitignore missing');

        for (const file of files) {
          assert.ok(existsSync(join(projectDir, file)), `${file} was not generated`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('create error handling', () => {
  test('refuses to overwrite an existing directory', () => {
    const dir = makeTempDir();
    try {
      const first = runCli(['create', 'dupe', '--template', 'vite', '--skip-git'], dir);
      assert.equal(first.status, 0, first.stderr || first.stdout);

      const second = runCli(['create', 'dupe', '--template', 'vite', '--skip-git'], dir);
      assert.notEqual(second.status, 0, 'second create should fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects an unknown template', () => {
    const dir = makeTempDir();
    try {
      const result = runCli(['create', 'bogus', '--template', 'angular', '--skip-git'], dir);
      assert.notEqual(result.status, 0, 'unknown template should fail');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// dev and build: framework detection and real tool runs
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { detectProject, devCommandFor, buildCommandFor } from '../dist/utils/project.js';

/** Stop a spawned process and everything it started, then wait for it to exit. */
function stopProcessTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      // Escalate if the tree ignored SIGTERM.
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  });
}

const INSTALL_TIMEOUT = 5 * 60_000;

function writePkg(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

describe('framework detection', () => {
  test('errors when there is no package.json', () => {
    const dir = makeTempDir();
    try {
      assert.throws(() => detectProject(dir), /No package\.json found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('errors when neither next nor vite is a dependency', () => {
    const dir = makeTempDir();
    try {
      writePkg(dir, { name: 'x', dependencies: { react: '^18.0.0' } });
      assert.throws(() => detectProject(dir), /Could not detect/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('detects vite from devDependencies', () => {
    const dir = makeTempDir();
    try {
      writePkg(dir, { name: 'x', devDependencies: { vite: '^5.0.0' } });
      assert.equal(detectProject(dir).framework, 'vite');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prefers next when both next and vite are present', () => {
    const dir = makeTempDir();
    try {
      writePkg(dir, { name: 'x', dependencies: { next: '^14.0.0' }, devDependencies: { vite: '^5.0.0' } });
      assert.equal(detectProject(dir).framework, 'nextjs');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('command construction', () => {
  test('vite dev passes port and host through', () => {
    const cmd = devCommandFor('vite', { port: '4000', host: '0.0.0.0' });
    assert.equal(cmd.bin, 'vite');
    assert.deepEqual(cmd.args, ['--port', '4000', '--host', '0.0.0.0']);
  });

  test('next dev uses -p and -H', () => {
    const cmd = devCommandFor('nextjs', { port: '4000', host: '0.0.0.0' });
    assert.equal(cmd.bin, 'next');
    assert.deepEqual(cmd.args, ['dev', '-p', '4000', '-H', '0.0.0.0']);
  });

  test('vite build honours --outdir', () => {
    assert.deepEqual(buildCommandFor('vite', { outdir: 'out' }).args, ['build', '--outDir', 'out']);
  });

  test('next build ignores outdir', () => {
    assert.deepEqual(buildCommandFor('nextjs', { outdir: 'out' }).args, ['build']);
  });
});

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

describe('integration: scaffold, then dev and build', () => {
  test(
    'x-one build succeeds on a scaffolded React (Vite) project',
    { timeout: INSTALL_TIMEOUT },
    () => {
      const dir = makeTempDir();
      try {
        const create = runCli(['create', 'build-vite', '--template', 'react', '--skip-git'], dir);
        assert.equal(create.status, 0, create.stderr || create.stdout);
        const projectDir = join(dir, 'build-vite');

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: projectDir, encoding: 'utf8', shell: true, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(install.status, 0, install.stderr);

        const build = runCli(['build'], projectDir);
        assert.equal(build.status, 0, build.stderr || build.stdout);
        assert.ok(existsSync(join(projectDir, 'dist', 'index.html')), 'dist/index.html not produced');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test(
    'x-one build succeeds on a scaffolded Next.js project',
    { timeout: INSTALL_TIMEOUT },
    () => {
      const dir = makeTempDir();
      try {
        const create = runCli(['create', 'build-next', '--template', 'nextjs', '--skip-git'], dir);
        assert.equal(create.status, 0, create.stderr || create.stdout);
        const projectDir = join(dir, 'build-next');

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: projectDir, encoding: 'utf8', shell: true, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(install.status, 0, install.stderr);

        const build = runCli(['build'], projectDir);
        assert.equal(build.status, 0, build.stderr || build.stdout);
        assert.ok(existsSync(join(projectDir, '.next')), '.next output not produced');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test(
    'x-one dev serves a scaffolded React (Vite) project',
    { timeout: INSTALL_TIMEOUT },
    async () => {
      const dir = makeTempDir();
      const logPath = join(dir, 'dev.log');
      let child;
      try {
        const create = runCli(['create', 'dev-vite', '--template', 'react', '--skip-git'], dir);
        assert.equal(create.status, 0, create.stderr || create.stdout);
        const projectDir = join(dir, 'dev-vite');

        const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
          cwd: projectDir, encoding: 'utf8', shell: true, timeout: INSTALL_TIMEOUT,
        });
        assert.equal(install.status, 0, install.stderr);

        const port = await freePort();
        // Send output to a file, not a pipe, so a leftover child cannot hold the test open.
        const logFd = openSync(logPath, 'w');
        child = spawn(process.execPath, [CLI, 'dev', '--port', String(port), '--host', '127.0.0.1'], {
          cwd: projectDir,
          detached: process.platform !== 'win32',
          stdio: ['ignore', logFd, logFd],
          env: { ...process.env, BROWSER: 'none' },
        });
        closeSync(logFd);

        const up = await waitForHttp(`http://127.0.0.1:${port}/`, 60_000);
        assert.ok(up, `dev server did not respond on port ${port}. Log:\n${readFileSync(logPath, 'utf8')}`);
      } finally {
        await stopProcessTree(child);
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      }
    },
  );
});
