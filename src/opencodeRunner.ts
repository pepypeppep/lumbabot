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
  resultText?: string;
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
- IF AND ONLY IF you need to execute runtime commands (e.g. php artisan, composer, phpunit, npm), execute them inside the container via:
  ${dockerInfo.recommendedCommandPrefix} <command>
- DO NOT run database migrations (e.g. artisan migrate) or destructive commands unless explicitly requested by the user prompt.
- For code inspections, file checks, or questions, answer directly without running container commands.
`;
  } else if (dockerInfo.hasDockerCompose) {
    dockerInstructions = `
[ENVIRONMENT NOTE: This project runs inside Docker Compose]
- Docker Compose configuration detected: ${dockerInfo.composeFileName} (Services: ${dockerInfo.detectedServices.join(", ") || "app"}).
- IF AND ONLY IF you need to execute application commands (e.g. tests, composer), execute them inside the running container using:
  \`${dockerInfo.recommendedCommandPrefix} <command>\`
- DO NOT run database migrations or destructive commands unless explicitly requested by the user prompt.
- For code inspections, file checks, or questions, answer directly without running container commands.
`;
  }

  // Enhance prompt to ensure opencode provides direct answers, structured feedback and follows Docker conventions
  const enhancedPrompt = `${prompt}
${dockerInstructions}
IMPORTANT INSTRUCTIONS:
- First, provide the direct answer, explanation, findings, or solution to the user's request clearly and concisely.
- If you investigated or fixed a bug, explain the root cause under a line starting with "Bug Cause:". If not a bug or not applicable, do NOT write "Bug Cause: N/A" or mention Bug Cause.
- If you modified files, created files, or ran tests, summarize them under a line starting with "Actions Done:".
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
    const shortPrompt = prompt.replace(/[\r\n]+/g, " ").trim();
    const promptPreview = shortPrompt.length > 80 ? `${shortPrompt.slice(0, 77)}...` : shortPrompt;
    console.log(`[OpenCode] Spawning: ${executable} run --dir ${projectDir} -m ${CONFIG.opencodeModel} ${CONFIG.opencodeFlags.join(" ")} "${promptPreview}"`);

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
      const success = code === 0;

      let bugCause = "";
      let actionsDone = "";
      let resultText = "";

      if (!success) {
        // Check if there is an error JSON in stderr / stdout
        const jsonStart = combined.indexOf("{");
        const jsonEnd = combined.lastIndexOf("}");
        let parsedErr: any = null;
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
          try {
            parsedErr = JSON.parse(combined.slice(jsonStart, jsonEnd + 1));
          } catch {
            // not valid JSON
          }
        }

        if (parsedErr) {
          const errName = parsedErr.name || "Error";
          const errMsg = parsedErr.data?.message || parsedErr.message || "Unknown error";
          const errRef = parsedErr.data?.ref ? ` [ref: ${parsedErr.data.ref}]` : "";
          bugCause = `OpenCode Error: ${errName} - ${errMsg}${errRef}`;
          actionsDone = `Execution aborted: ${errMsg}`;
        } else {
          const lines = combined.split("\n").map((l) => l.trim()).filter(Boolean);
          if (lines.length > 0) {
            bugCause = lines.slice(-2).join(" ");
            actionsDone = `Execution failed with exit code ${code}.`;
          } else {
            bugCause = `Execution failed with exit code ${code}.`;
          }
        }
      } else {
        const primaryText = stdoutData.trim() || combined;

        // 1. Extract Bug Cause if present and meaningful (not N/A, None, etc.)
        const bugMatch = primaryText.match(/(?:^|\n)\s*(?:Bug Cause|Root Cause):\s*([^\n]+(?:\n(?!(Actions Done|Actions Taken|Changes Made|Summary|Result):)[^\n]+)*)/i);
        if (bugMatch && bugMatch[1]) {
          const candidate = bugMatch[1].trim();
          if (!/^(n\/?a|none|not applicable|tidak ada|no bug)\.?$/i.test(candidate)) {
            bugCause = candidate;
          }
        }

        // 2. Extract Actions Done if present and meaningful
        const actionsMatch = primaryText.match(/(?:^|\n)\s*(?:Actions Done|Actions Taken|Changes Made):\s*([\s\S]+?)(?:\n\n|\n[A-Z][a-z]+:|$)/i);
        if (actionsMatch && actionsMatch[1]) {
          const candidate = actionsMatch[1].trim();
          if (!/^(n\/?a|none|not applicable|tidak ada)\.?$/i.test(candidate)) {
            actionsDone = candidate;
          }
        }

        // 3. Extract main result/answer (text before Bug Cause or Actions Done)
        const bugIdx = primaryText.search(/(?:^|\n)\s*(?:Bug Cause|Root Cause):/i);
        const actionsIdx = primaryText.search(/(?:^|\n)\s*(?:Actions Done|Actions Taken|Changes Made):/i);

        let cutIdx = -1;
        if (bugIdx !== -1 && actionsIdx !== -1) {
          cutIdx = Math.min(bugIdx, actionsIdx);
        } else if (bugIdx !== -1) {
          cutIdx = bugIdx;
        } else if (actionsIdx !== -1) {
          cutIdx = actionsIdx;
        }

        if (cutIdx > 0) {
          resultText = primaryText.substring(0, cutIdx).trim();
        } else if (cutIdx === -1) {
          resultText = primaryText.trim();
        } else {
          resultText = "";
        }

        // Fallback: if no resultText, no bugCause, and no actionsDone
        if (!resultText && !bugCause && !actionsDone) {
          resultText = primaryText.trim() || "Task completed successfully.";
        }
      }

      resolve({
        success,
        durationMs,
        durationFormatted: formatDuration(durationMs),
        output: combined,
        resultText,
        bugCause: bugCause || (success ? "" : `Execution failed with exit code ${code}.`),
        actionsDone,
        rawOutput: combined,
        exitCode: code,
      });
    });
  });
}
