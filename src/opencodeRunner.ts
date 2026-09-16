import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CONFIG } from "./config.js";
import { detectDockerEnvironment } from "./dockerDetector.js";

export interface OpenCodeRunResult {
  success: boolean;
  durationMs: number;
  durationFormatted: string;
  output: string;
  bugCause: string;
  actionsDone: string;
  rawOutput: string;
  exitCode: number | null;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m ${remainingSec}s`;
}

export function resolveOpencodeBinary(): string {
  // If explicitly configured to a custom path (not default "opencode"), check it first
  if (CONFIG.opencodePath && CONFIG.opencodePath !== "opencode") {
    if (fs.existsSync(CONFIG.opencodePath)) {
      return CONFIG.opencodePath;
    }
  }

  // Common candidate binary locations on Linux/macOS/Docker
  const candidatePaths = [
    path.join(os.homedir(), ".opencode", "bin", "opencode"),
    "/root/.opencode/bin/opencode",
    "/home/zsn/.opencode/bin/opencode",
    "/usr/local/bin/opencode",
    "/usr/bin/opencode",
    "/opt/homebrew/bin/opencode",
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return CONFIG.opencodePath || "opencode";
}

export async function runOpenCode(projectDir: string, prompt: string): Promise<OpenCodeRunResult> {
  const startTime = Date.now();

  // Detect if this project uses Docker
  const dockerInfo = detectDockerEnvironment(projectDir);
  let dockerInstructions = "";

  if (dockerInfo.hasLaravelSail) {
    dockerInstructions = `
[ENVIRONMENT NOTE: This project uses Laravel Sail]
- Whenever executing runtime commands (e.g. php artisan, composer, phpunit, npm), execute them inside the container via:
  ${dockerInfo.recommendedCommandPrefix} artisan <command>
  (e.g., \`${dockerInfo.recommendedCommandPrefix} artisan migrate\`)
`;
  } else if (dockerInfo.hasDockerCompose) {
    dockerInstructions = `
[ENVIRONMENT NOTE: This project runs inside Docker Compose]
- Docker Compose configuration detected: ${dockerInfo.composeFileName} (Services: ${dockerInfo.detectedServices.join(", ") || "app"}).
- Whenever executing application commands (e.g. php artisan, composer, npm, yarn, python, tests), DO NOT run them on the host system.
- Execute them inside the running container using non-interactive flag:
  \`${dockerInfo.recommendedCommandPrefix} <command>\`
  (e.g., \`${dockerInfo.recommendedCommandPrefix} php artisan migrate\`)
`;
  }

  // Enhance prompt to ensure opencode provides structured feedback and follows Docker conventions
  const enhancedPrompt = `${prompt}
${dockerInstructions}
IMPORTANT: When you complete this task, conclude your response with a concise summary in this format:
Bug Cause: <explain the root cause of the bug if applicable, or N/A>
Actions Done: <bullet list of what was changed, created, or tested>
`;

  const executable = resolveOpencodeBinary();

  const args = [
    "run",
    "--dir",
    projectDir,
    "-m",
    CONFIG.opencodeModel,
    ...CONFIG.opencodeFlags,
    enhancedPrompt,
  ];

  // Merge extra bin directories into PATH to ensure child process finds all tools
  const candidateBinDirs = [
    path.join(os.homedir(), ".opencode", "bin"),
    "/root/.opencode/bin",
    "/home/zsn/.opencode/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].filter((d) => fs.existsSync(d));

  const currentPath = process.env.PATH || "";
  const mergedPath = [...new Set([...candidateBinDirs, ...currentPath.split(path.delimiter)])].join(path.delimiter);

  return new Promise((resolve) => {
    console.log(`[OpenCode] Spawning: ${executable} ${args.join(" ")} in ${projectDir}`);

    const child = spawn(executable, args, {
      cwd: projectDir,
      env: { ...process.env, PATH: mergedPath, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdoutData = "";
    let stderrData = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutData += text;
      process.stdout.write(`[OpenCode OUT] ${text}`);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrData += text;
      process.stderr.write(`[OpenCode ERR] ${text}`);
    });

    child.on("error", (err: any) => {
      console.error(`[OpenCode] Process spawn error for "${executable}":`, err);
      const durationMs = Date.now() - startTime;
      const isNotFound = err.code === "ENOENT";
      const errorMsg = isNotFound
        ? `Binary "${executable}" not found in PATH. Ensure opencode is installed on the server/container.`
        : err.message;

      resolve({
        success: false,
        durationMs,
        durationFormatted: formatDuration(durationMs),
        output: `Failed to start opencode: ${errorMsg}`,
        bugCause: `Execution failed to launch (${errorMsg})`,
        actionsDone: `Error: ${errorMsg}`,
        rawOutput: stderrData,
        exitCode: -1,
      });
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - startTime;
      const combined = (stdoutData + "\n" + stderrData).trim();

      // Parse Bug Cause & Actions Done if present
      let bugCause = "Identified and resolved according to requested instructions.";
      let actionsDone = "Automated edits applied via OpenCode.";

      const bugMatch = combined.match(/Bug Cause:\s*([^\n]+(?:\n(?!(Actions Done|Summary):)[^\n]+)*)/i);
      if (bugMatch && bugMatch[1]) {
        bugCause = bugMatch[1].trim();
      }

      const actionsMatch = combined.match(/Actions Done:\s*([\s\S]+?)(?:\n\n|\n[A-Z][a-z]+:|$)/i);
      if (actionsMatch && actionsMatch[1]) {
        actionsDone = actionsMatch[1].trim();
      } else {
        // Fallback to last non-empty lines of output if parsing didn't find specific headers
        const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length > 0) {
          actionsDone = lines.slice(-4).join("\n");
        }
      }

      resolve({
        success: code === 0,
        durationMs,
        durationFormatted: formatDuration(durationMs),
        output: combined,
        bugCause,
        actionsDone,
        rawOutput: combined,
        exitCode: code,
      });
    });
  });
}
