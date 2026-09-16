import { exec } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG } from "./config.js";

const execAsync = promisify(exec);

export interface GitPreSyncResult {
  isGit: boolean;
  branch: string;
  pullStatus: string;
}

export interface GitPostSyncResult {
  isGit: boolean;
  branch: string;
  filesChanged: number;
  filesList: string[];
  pushStatus: string;
  isUpToDate: boolean;
  summaryText: string;
}

// Mask any embedded PAT or password in git URLs to prevent leakage in WhatsApp messages
function sanitizeGitOutput(text: string): string {
  return text.replace(/https?:\/\/[^@\s]+@/g, "https://***@");
}

async function runGit(cmd: string, cwd: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: 30000,
      env: {
        ...process.env,
        // Prevent git from hanging on interactive password prompts
        GIT_TERMINAL_PROMPT: "0",
        // Automatically accept new SSH host keys without prompt
        GIT_SSH_COMMAND: "ssh -o StrictHostKeyChecking=accept-new",
      },
    });
    return {
      stdout: sanitizeGitOutput(stdout.trim()),
      stderr: sanitizeGitOutput(stderr.trim()),
      success: true,
    };
  } catch (err: any) {
    const rawOut = err.stdout?.trim() || "";
    const rawErr = err.stderr?.trim() || err.message;
    return {
      stdout: sanitizeGitOutput(rawOut),
      stderr: sanitizeGitOutput(rawErr),
      success: false,
    };
  }
}

export async function preExecutionGitSync(repoPath: string): Promise<GitPreSyncResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return { isGit: false, branch: "none", pullStatus: "Not a git repository" };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  if (!CONFIG.autoPull) {
    return { isGit: true, branch, pullStatus: "Auto-pull disabled" };
  }

  // Attempt git pull
  const pullRes = await runGit(`git pull --rebase origin ${branch} || git pull origin ${branch} || git pull`, repoPath);
  let pullStatus = "Pull succeeded";
  if (!pullRes.success) {
    pullStatus = `Pull warning/error: ${pullRes.stderr || pullRes.stdout}`;
  } else if (pullRes.stdout.includes("Already up to date")) {
    pullStatus = "Already up to date";
  } else {
    pullStatus = `Pulled latest changes on ${branch}`;
  }

  return { isGit: true, branch, pullStatus };
}

export async function postExecutionGitSync(repoPath: string, taskPrompt: string): Promise<GitPostSyncResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return {
      isGit: false,
      branch: "none",
      filesChanged: 0,
      filesList: [],
      pushStatus: "N/A",
      isUpToDate: false,
      summaryText: "Not a git repository",
    };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  // Check modified / untracked files
  const statusRes = await runGit("git status --porcelain", repoPath);
  const statusLines = statusRes.stdout ? statusRes.stdout.split("\n").filter(Boolean) : [];
  const filesList = statusLines.map((l) => l.substring(3).trim());
  const filesChanged = filesList.length;

  let pushStatus = "No changes to push";
  let isUpToDate = true;

  if (CONFIG.autoPush) {
    if (filesChanged > 0) {
      // Stage and commit changes
      await runGit("git add -A", repoPath);
      const sanitizedPrompt = taskPrompt.slice(0, 60).replace(/["`$]/g, "");
      const commitMsg = `fix: [Lumba] ${sanitizedPrompt}`;
      await runGit(`git commit -m "${commitMsg}"`, repoPath);
    }

    // Check if we have unpushed commits
    const unpushedCheck = await runGit(`git log origin/${branch}..HEAD --oneline || git log @{u}..HEAD --oneline`, repoPath);
    const hasUnpushed = unpushedCheck.success && unpushedCheck.stdout.length > 0;

    if (hasUnpushed || filesChanged > 0) {
      const pushRes = await runGit(`git push origin ${branch}`, repoPath);
      if (pushRes.success) {
        pushStatus = `Pushed successfully to origin/${branch}`;
        isUpToDate = true;
      } else {
        pushStatus = `Push failed: ${pushRes.stderr || pushRes.stdout}`;
        isUpToDate = false;
      }
    } else {
      pushStatus = "Up to date with origin";
    }
  }

  // Final check if up to date with remote
  const finalCheck = await runGit("git status -uno", repoPath);
  if (finalCheck.stdout.includes("Your branch is up to date")) {
    isUpToDate = true;
  } else if (finalCheck.stdout.includes("Your branch is ahead")) {
    isUpToDate = false;
  }

  const summaryText = [
    `• Branch: ${branch}`,
    filesChanged > 0 ? `• Files changed: ${filesChanged} file(s)` : `• Files changed: None (clean working tree)`,
    `• Remote sync: ${pushStatus}`,
    `• Repo status: ${isUpToDate ? "✅ Up to date" : "⚠️ Needs push/pull sync"}`,
  ].join("\n");

  return {
    isGit: true,
    branch,
    filesChanged,
    filesList,
    pushStatus,
    isUpToDate,
    summaryText,
  };
}
