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

export interface GitPullResult {
  isGit: boolean;
  branch: string;
  success: boolean;
  pullStatus: string;
  output: string;
}

export interface GitPushResult {
  isGit: boolean;
  branch: string;
  success: boolean;
  filesChanged: number;
  filesList: string[];
  pushStatus: string;
  commitMsg?: string;
  output: string;
}

export interface GitStatusResult {
  isGit: boolean;
  branch: string;
  filesChanged: number;
  filesList: string[];
  unpushedCommits: number;
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
        // Bypass dubious ownership checks when container user differs from directory owner
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: "*",
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
  } else {
    pushStatus = "Skipped (auto-push disabled)";
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

export async function executeGitPull(repoPath: string, args?: string): Promise<GitPullResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return {
      isGit: false,
      branch: "none",
      success: false,
      pullStatus: "Not a git repository",
      output: isGitCheck.stderr,
    };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  let pullCmd = `git pull --rebase origin ${branch} || git pull origin ${branch} || git pull`;
  if (args && args.trim()) {
    pullCmd = `git pull ${args.trim()}`;
  }

  const pullRes = await runGit(pullCmd, repoPath);
  let pullStatus = "Pull succeeded";
  if (!pullRes.success) {
    pullStatus = `Pull warning/error: ${pullRes.stderr || pullRes.stdout}`;
  } else if (pullRes.stdout.includes("Already up to date")) {
    pullStatus = "Already up to date";
  } else {
    pullStatus = `Pulled latest changes on ${branch}`;
  }

  return {
    isGit: true,
    branch,
    success: pullRes.success,
    pullStatus,
    output: pullRes.stdout || pullRes.stderr,
  };
}

export async function executeGitPush(repoPath: string, customMessage?: string): Promise<GitPushResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return {
      isGit: false,
      branch: "none",
      success: false,
      filesChanged: 0,
      filesList: [],
      pushStatus: "Not a git repository",
      output: isGitCheck.stderr,
    };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  // Check modified / untracked files
  const statusRes = await runGit("git status --porcelain", repoPath);
  const statusLines = statusRes.stdout ? statusRes.stdout.split("\n").filter(Boolean) : [];
  const filesList = statusLines.map((l) => l.substring(3).trim());
  const filesChanged = filesList.length;

  let commitMsg = customMessage?.trim();

  // If there are uncommitted changes, stage and commit
  if (filesChanged > 0) {
    await runGit("git add -A", repoPath);
    if (!commitMsg) {
      commitMsg = `fix: [Lumba] updates to ${filesList.slice(0, 3).join(", ")}${filesChanged > 3 ? ` and ${filesChanged - 3} more` : ""}`;
    }
    const sanitizedMsg = commitMsg.replace(/["`$]/g, "");
    const commitRes = await runGit(`git commit -m "${sanitizedMsg}"`, repoPath);
    if (!commitRes.success) {
      return {
        isGit: true,
        branch,
        success: false,
        filesChanged,
        filesList,
        commitMsg,
        pushStatus: `Commit failed: ${commitRes.stderr || commitRes.stdout}`,
        output: commitRes.stderr || commitRes.stdout,
      };
    }
  }

  // Check if there are unpushed commits
  const unpushedCheck = await runGit(`git log origin/${branch}..HEAD --oneline || git log @{u}..HEAD --oneline`, repoPath);
  const hasUnpushed = unpushedCheck.success && unpushedCheck.stdout.length > 0;

  if (!hasUnpushed && filesChanged === 0) {
    return {
      isGit: true,
      branch,
      success: true,
      filesChanged: 0,
      filesList: [],
      commitMsg,
      pushStatus: "Already up to date with origin (no changes or unpushed commits)",
      output: "Everything up-to-date",
    };
  }

  // Execute git push
  const pushRes = await runGit(`git push origin ${branch}`, repoPath);
  if (pushRes.success) {
    return {
      isGit: true,
      branch,
      success: true,
      filesChanged,
      filesList,
      commitMsg,
      pushStatus: `Pushed successfully to origin/${branch}`,
      output: pushRes.stdout || pushRes.stderr,
    };
  } else {
    return {
      isGit: true,
      branch,
      success: false,
      filesChanged,
      filesList,
      commitMsg,
      pushStatus: `Push failed: ${pushRes.stderr || pushRes.stdout}`,
      output: pushRes.stderr || pushRes.stdout,
    };
  }
}

export async function executeGitStatus(repoPath: string): Promise<GitStatusResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return {
      isGit: false,
      branch: "none",
      filesChanged: 0,
      filesList: [],
      unpushedCommits: 0,
      isUpToDate: false,
      summaryText: "Not a git repository",
    };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  const statusRes = await runGit("git status --porcelain", repoPath);
  const statusLines = statusRes.stdout ? statusRes.stdout.split("\n").filter(Boolean) : [];
  const filesList = statusLines.map((l) => l.substring(3).trim());
  const filesChanged = filesList.length;

  const unpushedCheck = await runGit(`git log origin/${branch}..HEAD --oneline || git log @{u}..HEAD --oneline`, repoPath);
  const unpushedLines = unpushedCheck.stdout ? unpushedCheck.stdout.split("\n").filter(Boolean) : [];
  const unpushedCommits = unpushedLines.length;

  const finalCheck = await runGit("git status -uno", repoPath);
  const isUpToDate = finalCheck.stdout.includes("Your branch is up to date") && unpushedCommits === 0 && filesChanged === 0;

  const summaryText = [
    `• Branch: ${branch}`,
    filesChanged > 0 ? `• Files changed: ${filesChanged} file(s)` : `• Files changed: None (clean working tree)`,
    unpushedCommits > 0 ? `• Unpushed commits: ${unpushedCommits}` : `• Unpushed commits: 0`,
    `• Repo status: ${isUpToDate ? "✅ Up to date" : "⚠️ Needs push/pull sync"}`,
  ].join("\n");

  return {
    isGit: true,
    branch,
    filesChanged,
    filesList,
    unpushedCommits,
    isUpToDate,
    summaryText,
  };
}

export async function getWorkingTreeStatus(repoPath: string): Promise<GitPostSyncResult> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return {
      isGit: false,
      branch: "none",
      filesChanged: 0,
      filesList: [],
      pushStatus: "N/A",
      isUpToDate: true,
      summaryText: "Not a git repository",
    };
  }

  const branchCheck = await runGit("git branch --show-current", repoPath);
  const branch = branchCheck.stdout || "main";

  const statusRes = await runGit("git status --porcelain", repoPath);
  const statusLines = statusRes.stdout ? statusRes.stdout.split("\n").filter(Boolean) : [];
  const filesList = statusLines.map((l) => l.substring(3).trim());
  const filesChanged = filesList.length;

  const finalCheck = await runGit("git status -uno", repoPath);
  const isUpToDate = finalCheck.stdout.includes("Your branch is up to date") && filesChanged === 0;

  return {
    isGit: true,
    branch,
    filesChanged,
    filesList,
    pushStatus: "Skipped (run '@lumba <project> git push' to push)",
    isUpToDate,
    summaryText: `Branch: ${branch}, ${filesChanged} file(s) changed`,
  };
}

export interface WorkingTreeSnapshot {
  isGit: boolean;
  statusMap: Map<string, string>;
  diffHash: string;
}

export async function getWorkingTreeSnapshot(repoPath: string): Promise<WorkingTreeSnapshot> {
  const isGitCheck = await runGit("git rev-parse --is-inside-work-tree", repoPath);
  if (!isGitCheck.success || isGitCheck.stdout !== "true") {
    return { isGit: false, statusMap: new Map(), diffHash: "" };
  }

  const statusRes = await runGit("git status --porcelain", repoPath);
  const statusMap = new Map<string, string>();
  if (statusRes.success && statusRes.stdout) {
    for (const line of statusRes.stdout.split("\n").filter(Boolean)) {
      const code = line.substring(0, 2);
      const filePath = line.substring(3).trim();
      statusMap.set(filePath, code);
    }
  }

  const diffRes = await runGit("git diff", repoPath);
  const diffHash = diffRes.stdout || "";

  return { isGit: true, statusMap, diffHash };
}

export function detectNewlyModifiedFiles(
  pre: WorkingTreeSnapshot,
  post: WorkingTreeSnapshot
): string[] {
  if (!post.isGit) return [];

  const newlyChanged: string[] = [];

  for (const [file, code] of post.statusMap.entries()) {
    if (!pre.statusMap.has(file) || pre.statusMap.get(file) !== code) {
      newlyChanged.push(file);
    }
  }

  if (pre.diffHash !== post.diffHash && newlyChanged.length === 0) {
    for (const [file] of post.statusMap.entries()) {
      if (!file.startsWith("??")) {
        newlyChanged.push(file);
      }
    }
  }

  return newlyChanged;
}

