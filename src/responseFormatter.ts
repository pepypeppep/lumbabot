import { GitPostSyncResult, GitPullResult, GitPushResult, GitStatusResult } from "./gitManager.js";
import { OpenCodeRunResult } from "./opencodeRunner.js";

export interface FormatOptions {
  projectName: string;
  projectPath: string;
  opencodeResult: OpenCodeRunResult;
  gitResult: GitPostSyncResult;
  pullStatus: string;
  newlyModifiedFiles?: string[];
}

/**
 * Normalizes standard markdown formatting for WhatsApp:
 * Converts **bold** outside code blocks to WhatsApp *bold*.
 */
export function formatForWhatsApp(text: string): string {
  if (!text) return "";
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part) => {
      if (part.startsWith("`")) return part;
      return part.replace(/\*\*([^*]+)\*\*/g, "*$1*");
    })
    .join("");
}

export function formatCommandDoneMessage(opts: FormatOptions): string {
  const { projectName, opencodeResult, gitResult, pullStatus, newlyModifiedFiles } = opts;

  const title = opencodeResult.success ? "✅ *Command Done*" : "❌ *Command Failed*";

  const sections: string[] = [
    title,
    "",
    `📁 *Project*: ${projectName}`,
    `⏱️ *Total Execution Time*: ${opencodeResult.durationFormatted}`,
  ];

  if (opencodeResult.success) {
    // 1. Result / Answer / Main Response
    const mainResult = (
      opencodeResult.resultText ||
      (!opencodeResult.bugCause && !opencodeResult.actionsDone ? opencodeResult.output : "")
    ).trim();

    if (mainResult) {
      sections.push("", `💬 *Result*:`, formatForWhatsApp(mainResult));
    }

    // 2. Bug Cause / Analysis (Only show if meaningful and not redundant with main result)
    const bugCause = opencodeResult.bugCause?.trim();
    const isMeaningfulBugCause =
      Boolean(bugCause) &&
      !/^(n\/?a|none|not applicable|tidak ada|no bug|identified and resolved according to requested instructions)\.?$/i.test(bugCause!) &&
      bugCause !== mainResult;

    if (isMeaningfulBugCause) {
      sections.push("", `🔍 *Bug Cause / Analysis*:`, formatForWhatsApp(bugCause!));
    }

    // 3. Actions Completed (Only show if meaningful and not redundant with main result)
    const actionsDone = opencodeResult.actionsDone?.trim();
    const isMeaningfulActions =
      Boolean(actionsDone) &&
      !/^(n\/?a|none|not applicable|tidak ada|automated edits applied via opencode|task completed successfully)\.?$/i.test(actionsDone!) &&
      actionsDone !== mainResult;

    if (isMeaningfulActions) {
      sections.push("", `🛠️ *Actions Completed*:`, formatForWhatsApp(actionsDone!));
    }

    // 4. Git Pull Status (only if pulled changes or encountered error/warning)
    if (
      pullStatus &&
      !pullStatus.includes("Skipped") &&
      !pullStatus.includes("Already up to date") &&
      !pullStatus.includes("Not a git repository")
    ) {
      sections.push("", `📥 *Git Pull*: ${pullStatus}`);
    }

    // 5. Files Modified & Git Push status
    const modifiedFiles =
      newlyModifiedFiles !== undefined
        ? newlyModifiedFiles
        : (gitResult.filesList || []);

    const hasModifiedFiles =
      modifiedFiles.length > 0 ||
      (newlyModifiedFiles === undefined && gitResult.filesChanged > 0);

    if (hasModifiedFiles) {
      const count = modifiedFiles.length || gitResult.filesChanged;
      const fileListPreview =
        modifiedFiles.length > 0
          ? "\n" +
            modifiedFiles
              .slice(0, 8)
              .map((f) => `• \`${f}\``)
              .join("\n") +
            (modifiedFiles.length > 8 ? `\n...dan ${modifiedFiles.length - 8} file lainnya` : "")
          : "";

      sections.push("", `📦 *Files Modified* (${count} file(s)):${fileListPreview}`);

      if (
        gitResult.pushStatus &&
        !gitResult.pushStatus.includes("Skipped") &&
        !gitResult.pushStatus.includes("N/A")
      ) {
        sections.push(`📤 *Git Push*: ${gitResult.pushStatus}`);
      } else if (gitResult.pushStatus && gitResult.pushStatus.includes("Skipped")) {
        sections.push(
          "",
          `💡 *Next Step*: Gunakan \`@lumba ${projectName} git push\` untuk commit & push perubahan.`
        );
      }
    } else if (
      gitResult.pushStatus &&
      !gitResult.pushStatus.includes("Skipped") &&
      !gitResult.pushStatus.includes("N/A") &&
      !gitResult.pushStatus.includes("No changes")
    ) {
      sections.push("", `📤 *Git Push*: ${gitResult.pushStatus}`);
    }
  } else {
    // Failure case: show error details
    const errorDetails =
      opencodeResult.bugCause ||
      opencodeResult.output ||
      "Execution failed without output";

    sections.push("", `⚠️ *Error / Root Cause*:`, formatForWhatsApp(errorDetails));

    if (
      opencodeResult.actionsDone &&
      !opencodeResult.actionsDone.startsWith("Execution failed") &&
      !opencodeResult.actionsDone.startsWith("Error:")
    ) {
      sections.push("", `🛠️ *Actions Attempted*:`, formatForWhatsApp(opencodeResult.actionsDone));
    }
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
