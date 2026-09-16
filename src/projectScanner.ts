import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "./config.js";

export interface ProjectScanResult {
  found: boolean;
  projectPath?: string;
  projectName?: string;
  isGitRepo?: boolean;
  error?: string;
  availableProjects?: string[];
}

export function scanProjectDirectory(targetName: string): ProjectScanResult {
  const baseDir = CONFIG.projectsBaseDir;

  if (!fs.existsSync(baseDir)) {
    return {
      found: false,
      error: `Projects base directory does not exist: ${baseDir}`,
      availableProjects: [],
    };
  }

  // Prevent directory traversal attacks
  const cleanName = path.basename(targetName.trim());
  if (!cleanName || cleanName === "." || cleanName === "..") {
    return {
      found: false,
      error: `Invalid project name provided: "${targetName}"`,
      availableProjects: getAvailableProjects(baseDir),
    };
  }

  const directPath = path.join(baseDir, cleanName);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isDirectory()) {
    return {
      found: true,
      projectPath: directPath,
      projectName: cleanName,
      isGitRepo: fs.existsSync(path.join(directPath, ".git")),
    };
  }

  // Case-insensitive or partial scan
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const directories = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    // 1. Case-insensitive exact match
    const caseMatch = directories.find((d) => d.toLowerCase() === cleanName.toLowerCase());
    if (caseMatch) {
      const matchPath = path.join(baseDir, caseMatch);
      return {
        found: true,
        projectPath: matchPath,
        projectName: caseMatch,
        isGitRepo: fs.existsSync(path.join(matchPath, ".git")),
      };
    }

    // 2. Starts with / prefix match
    const prefixMatch = directories.find((d) => d.toLowerCase().startsWith(cleanName.toLowerCase()));
    if (prefixMatch) {
      const matchPath = path.join(baseDir, prefixMatch);
      return {
        found: true,
        projectPath: matchPath,
        projectName: prefixMatch,
        isGitRepo: fs.existsSync(path.join(matchPath, ".git")),
      };
    }

    return {
      found: false,
      error: `Project "${cleanName}" not found in ${baseDir}`,
      availableProjects: directories,
    };
  } catch (err: any) {
    return {
      found: false,
      error: `Failed to scan directory ${baseDir}: ${err.message}`,
      availableProjects: [],
    };
  }
}

export function getAvailableProjects(baseDir: string): string[] {
  try {
    if (!fs.existsSync(baseDir)) return [];
    return fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    return [];
  }
}
