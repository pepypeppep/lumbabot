import { GitPostSyncResult, GitPullResult, GitPushResult, GitStatusResult } from "./gitManager.js";
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

  const title = opencodeResult.success ? "✅ *Command Done*" : "❌ *Command Failed*";

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

  if (gitResult.filesChanged > 0 && gitResult.pushStatus.includes("Skipped")) {
    sections.push(
      "",
      `💡 *Next Step*: Gunakan \`@lumba ${projectName} git push\` untuk commit & push perubahan.`
    );
  }

  return sections.join("\n");
}

export function formatGitPullMessage(projectName: string, result: GitPullResult): string {
  const icon = result.success ? "✅" : "❌";
  const title = result.success ? `${icon} *Git Pull Succeeded*` : `${icon} *Git Pull Failed*`;

  const lines = [
    title,
    "",
    `📁 *Project*: ${projectName}`,
    `🌿 *Branch*: \`${result.branch}\``,
    `📥 *Status*: ${result.pullStatus}`,
  ];

  if (result.output && !result.success) {
    lines.push("", `⚠️ *Output / Error*:`, `\`\`\`${result.output.slice(0, 500)}\`\`\``);
  } else if (result.output && !result.output.includes("Already up to date")) {
    const preview = result.output.slice(0, 300);
    lines.push("", `📝 *Details*:`, `\`\`\`${preview}\`\`\``);
  }

  return lines.join("\n");
}

export function formatGitPushMessage(projectName: string, result: GitPushResult): string {
  const icon = result.success ? "✅" : "❌";
  const title = result.success ? `${icon} *Git Push Succeeded*` : `${icon} *Git Push Failed*`;

  const lines = [
    title,
    "",
    `📁 *Project*: ${projectName}`,
    `🌿 *Branch*: \`${result.branch}\``,
    `📦 *Files Committed*: ${result.filesChanged > 0 ? `${result.filesChanged} file(s)` : "None"}`,
  ];

  if (result.commitMsg) {
    lines.push(`💬 *Commit Message*: "${result.commitMsg}"`);
  }

  lines.push(`📤 *Push Status*: ${result.pushStatus}`);

  if (result.filesList && result.filesList.length > 0) {
    const displayedFiles = result.filesList.slice(0, 8).map((f) => `• \`${f}\``).join("\n");
    const more = result.filesList.length > 8 ? `\n...dan ${result.filesList.length - 8} file lainnya` : "";
    lines.push("", `📄 *Files:*`, displayedFiles + more);
  }

  if (result.output && !result.success) {
    lines.push("", `⚠️ *Error Details*:`, `\`\`\`${result.output.slice(0, 500)}\`\`\``);
  }

  return lines.join("\n");
}

export function formatGitStatusMessage(projectName: string, result: GitStatusResult): string {
  const title = `📦 *Git Status: ${projectName}*`;
  const lines = [
    title,
    "",
    `🌿 *Branch*: \`${result.branch}\``,
    `📁 *Modified/Untracked Files*: ${result.filesChanged > 0 ? `${result.filesChanged} file(s)` : "Clean (no changes)"}`,
    `🔄 *Sync Status*: ${result.isUpToDate ? "✅ Up to date with remote" : "⚠️ Out of sync / Has unpushed commits"}`,
  ];

  if (result.filesList && result.filesList.length > 0) {
    const list = result.filesList.slice(0, 10).map((f) => `• \`${f}\``).join("\n");
    const more = result.filesList.length > 10 ? `\n...dan ${result.filesList.length - 10} file lainnya` : "";
    lines.push("", `📄 *Changes:*`, list + more);
    lines.push("", `💡 Gunakan \`@lumba ${projectName} git push\` untuk push perubahan.`);
  }

  return lines.join("\n");
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

export function formatHelpMessage(available: string[], baseDir?: string): string {
  const count = available.length;
  const dirPath = baseDir || "/home/zsn/code";
  const projList =
    count > 0
      ? available.slice(0, 15).map((p) => `• \`${p}\``).join("\n") +
        (count > 15 ? `\n...dan ${count - 15} project lainnya` : "")
      : `(Tidak ada direktori project ditemukan di \`${dirPath}\`)`;

  return [
    `🤖 *Lumba Bot - AI Coding Assistant*`,
    `Siap menjalankan instruksi di repository / codebase kamu.`,
    ``,
    `📊 *Total Project di \`${dirPath}\`*: *${count} project*`,
    ``,
    `📌 *Format Perintah:*`,
    `• \`@lumba <nama_project> <instruksi>\` (Jalankan AI OpenCode)`,
    `• \`@lumba <nama_project> git pull\` (Tarik perubahan terbaru)`,
    `• \`@lumba <nama_project> git push [pesan]\` (Commit & push perubahan)`,
    `• \`@lumba <nama_project> git status\` (Cek status git repo)`,
    ``,
    `💡 *Contoh:*`,
    `• \`@lumba corpu tolong perbaiki auth token bug\``,
    `• \`@lumba corpu git pull\``,
    `• \`@lumba corpu git push fix auth error\``,
    `• \`@lumba corpu git status\``,
    `• Reply pesan error / stack trace: \`@lumba corpu perbaiki error ini\``,
    ``,
    `📂 *Daftar Project (${count}):*`,
    projList,
  ].join("\n");
}
