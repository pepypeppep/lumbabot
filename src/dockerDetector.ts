import fs from "node:fs";
import path from "node:path";

export interface DockerEnvironmentInfo {
  hasDockerCompose: boolean;
  hasLaravelSail: boolean;
  composeFileName?: string;
  recommendedCommandPrefix: string;
  detectedServices: string[];
}

export function detectDockerEnvironment(projectDir: string): DockerEnvironmentInfo {
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];

  let foundCompose = "";
  for (const file of composeFiles) {
    if (fs.existsSync(path.join(projectDir, file))) {
      foundCompose = file;
      break;
    }
  }

  const hasSail = fs.existsSync(path.join(projectDir, "vendor/bin/sail"));

  if (hasSail) {
    return {
      hasDockerCompose: true,
      hasLaravelSail: true,
      composeFileName: foundCompose || "docker-compose.yml",
      recommendedCommandPrefix: "./vendor/bin/sail",
      detectedServices: ["app", "laravel.test"],
    };
  }

  if (foundCompose) {
    // Attempt to inspect service names from docker-compose.yml
    const content = fs.readFileSync(path.join(projectDir, foundCompose), "utf-8");
    const detectedServices: string[] = [];

    // Simple regex to find top-level service keys under `services:`
    const lines = content.split("\n");
    let inServices = false;

    for (const line of lines) {
      if (/^services:\s*$/i.test(line)) {
        inServices = true;
        continue;
      }
      if (inServices) {
        // Exit if top-level non-indented key starts (e.g. volumes:, networks:)
        if (/^[a-zA-Z0-9_\-]+:\s*$/.test(line)) {
          break;
        }
        const serviceMatch = line.match(/^  ([a-zA-Z0-9_\-]+):\s*$/);
        if (serviceMatch) {
          detectedServices.push(serviceMatch[1]);
        }
      }
    }

    // Pick most likely app service: app, php, workspace, web, or the first one
    const preferredOrder = ["app", "php", "workspace", "web", "backend", "server"];
    const targetService =
      preferredOrder.find((s) => detectedServices.includes(s)) ||
      detectedServices[0] ||
      "app";

    return {
      hasDockerCompose: true,
      hasLaravelSail: false,
      composeFileName: foundCompose,
      recommendedCommandPrefix: `docker compose exec -T ${targetService}`,
      detectedServices,
    };
  }

  return {
    hasDockerCompose: false,
    hasLaravelSail: false,
    recommendedCommandPrefix: "",
    detectedServices: [],
  };
}
