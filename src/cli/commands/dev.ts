import { Command } from 'commander';
import chalk from 'chalk';
import { detectProject, devCommandFor } from '../../utils/project.js';
import { runTool } from '../../utils/run.js';

export const devCommand = new Command()
  .name('dev')
  .description('Start the development server for the current project')
  .option('-p, --port <port>', 'Port to run on (default: framework default)')
  .option('--host <host>', 'Host to bind to (default: framework default)')
  .action(async (options) => {
    try {
      const root = process.cwd();
      const project = detectProject(root);
      const command = devCommandFor(project.framework, {
        port: options.port,
        host: options.host,
      });

      console.log(
        chalk.blue.bold(`\n🚀 Starting ${project.framework} dev server...\n`)
      );

      const code = await runTool(root, command);
      process.exit(code);
    } catch (error) {
      console.error(
        chalk.red('Error starting dev server:'),
        error instanceof Error ? error.message : error
      );
      process.exit(1);
    }
  });
