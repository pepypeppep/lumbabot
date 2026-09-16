import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

dotenv.config();

function resolveProjectsBaseDir(): string {
  const envDir = process.env.PROJECTS_BASE_DIR;
  if (envDir && fs.existsSync(envDir)) {
    return path.resolve(envDir);
  }

  // Common server path
  const linuxServerDir = "/home/zsn/code";
  if (fs.existsSync(linuxServerDir)) {
    return linuxServerDir;
  }

  // Fallback to ~/code on the current machine
  const userHomeCode = path.join(os.homedir(), "code");
  if (fs.existsSync(userHomeCode)) {
    return userHomeCode;
  }

  // Return configured or default even if not yet created
  return envDir ? path.resolve(envDir) : linuxServerDir;
}

function resolveOpencodeModel(): string {
  const model = process.env.OPENCODE_MODEL || "deepseek/deepseek-v4-flash";
  // Auto-normalize if user configured ai-bid3/... without provider prefix bidang3/
  if (model.startsWith("ai-bid3/")) {
    return `bidang3/${model}`;
  }
  return model;
}

export const CONFIG = {
  projectsBaseDir: resolveProjectsBaseDir(),
  opencodeModel: resolveOpencodeModel(),
  opencodePath: process.env.OPENCODE_PATH || "opencode",
  // --auto runs opencode in YOLO / auto-approve mode for permissions
  opencodeFlags: (process.env.OPENCODE_FLAGS || "--auto").split(" ").filter(Boolean),
  botName: (process.env.BOT_NAME || "lumba").toLowerCase(),
  autoPull: process.env.AUTO_PULL === "true",
  autoPush: process.env.AUTO_PUSH === "true",
  authSessionDir: process.env.AUTH_SESSION_DIR || "auth_info_baileys",
  allowedNumbers: process.env.ALLOWED_NUMBERS
    ? process.env.ALLOWED_NUMBERS.split(",").map((s) => s.trim().replace(/[^0-9]/g, ""))
    : [],
};
