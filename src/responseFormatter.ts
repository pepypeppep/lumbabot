import { GitPostSyncResult } from "./gitManager.js";
import { OpenCodeRunResult } from "./opencodeRunner.js";

export interface FormatOptions {
  projectName: string;
  projectPath: string;
  opencodeResult: OpenCodeRunResult;
  gitResult: GitPostSyncResult;
  pullStatus: string;
}

export function formatCommandDoneMessage(opts: FormatOptions): string {
  const { projectName, opencodeResult, gitResult, pullStatus } = opts;

  const statusEmoji = opencodeResult.success ? "✅" : "⚠️";
  const title = `${statusEmoji} *Command Done*`;

  const sections: string[] = [
    title,
    "",
    `📁 *Project*: ${projectName}`,
    `⏱️ *Total Execution Time*: ${opencodeResult.durationFormatted}`,
    "",
    `🔍 *Bug Cause / Analysis*:`,
    opencodeResult.bugCause || "N/A",
    "",
    `🛠️ *Actions Completed*:`,
    opencodeResult.actionsDone || "Task completed successfully.",
    "",
    `📦 *Git Repository Status*:`,
    `• Git Pull: ${pullStatus}`,
    `• Files Modified: ${gitResult.filesChanged > 0 ? `${gitResult.filesChanged} file(s)` : "None"}`,
    `• Git Push: ${gitResult.pushStatus}`,
    `• Codebase Sync: ${gitResult.isUpToDate ? "✅ Up to date with remote" : "⚠️ Needs push/pull verification"}`,
  ];

  return sections.join("\n");
}

export function formatRunningMessage(projectName: string, prompt: string): string {
  const shortPrompt = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
  return `⏳ *Command Running...*\n\n📁 *Project*: ${projectName}\n💬 *Task*: ${shortPrompt}`;
}

export function formatProjectNotFoundMessage(projectName: string, baseDir: string, available: string[]): string {
  const availableList = available.length > 0
    ? `\n\n📂 *Available projects in* \`${baseDir}\`:\n${available.slice(0, 10).map((p) => `• ${p}`).join("\n")}`
    : `\n\n(No directories found in \`${baseDir}\`)`;

  return `❌ *Project Not Found*\nCould not find project directory: *${projectName}* inside \`${baseDir}\`.${availableList}`;
}
