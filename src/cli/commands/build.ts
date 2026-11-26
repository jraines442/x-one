import { Command } from 'commander';
import chalk from 'chalk';
import { detectProject, buildCommandFor } from '../../utils/project.js';
import { runTool } from '../../utils/run.js';

export const buildCommand = new Command()
  .name('build')
  .description('Build the current project for production')
  .option('--outdir <dir>', 'Output directory (Vite projects only)')
  .action(async (options) => {
    try {
      const root = process.cwd();
      const project = detectProject(root);

      if (options.outdir && project.framework === 'nextjs') {
        console.log(
          chalk.yellow('Note: --outdir is ignored for Next.js; output goes to .next/')
        );
      }

      const command = buildCommandFor(project.framework, {
        outdir: options.outdir,
      });

      console.log(
        chalk.blue.bold(`\n📦 Building ${project.framework} project...\n`)
      );

      const code = await runTool(root, command);
      if (code === 0) {
        console.log(chalk.green.bold('\n✓ Build completed successfully\n'));
      } else {
        console.error(chalk.red(`\n✗ Build failed (exit code ${code})\n`));
      }
      process.exit(code);
    } catch (error) {
      console.error(
        chalk.red('Error during build:'),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
