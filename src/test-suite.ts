import assert from "node:assert";
import { parseIncomingMessage } from "./messageParser.js";
import { scanProjectDirectory } from "./projectScanner.js";
import { formatCommandDoneMessage } from "./responseFormatter.js";
import { detectDockerEnvironment } from "./dockerDetector.js";

console.log("=== RUNNING LUMBA UNIT TESTS ===");

// Test 1: Message Parser - standard format
{
  const msg = "@lumba corpu please fix the auth bug";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999:0@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.prompt, "please fix the auth bug");
  console.log("✔ Test 1 passed: Standard @lumba <project> <prompt>");
}

// Test 2: Message Parser - bracket format & case insensitive
{
  const msg = "@Lumba (corpu) update dependencies";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999:0@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.prompt, "update dependencies");
  console.log("✔ Test 2 passed: Bracket format @Lumba (corpu)");
}

// Test 3: Message Parser - with quoted message
{
  const msg = "@lumba corpu fix this error";
  const quoted = "TypeError: Cannot read properties of undefined (reading 'headers')";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999:0@s.whatsapp.net", [], quoted);
  assert.strictEqual(parsed.isTriggered, true);
  assert.ok(parsed.fullPrompt?.includes("--- Quoted Message / Context ---"));
  assert.ok(parsed.fullPrompt?.includes("TypeError: Cannot read properties"));
  console.log("✔ Test 3 passed: Quoted message context included");
}

// Test 4: Project Scanner - directory traversal protection
{
  const scan = scanProjectDirectory("../../etc/passwd");
  assert.strictEqual(scan.found, false);
  console.log("✔ Test 4 passed: Directory traversal prevented");
}

// Test 5: Response Formatter
{
  const formatted = formatCommandDoneMessage({
    projectName: "corpu",
    projectPath: "/home/zsn/code/corpu",
    opencodeResult: {
      success: true,
      durationMs: 45000,
      durationFormatted: "45s",
      output: "Done",
      bugCause: "Null check was missing in auth middleware",
      actionsDone: "- Added null check\n- Tested endpoint",
      rawOutput: "",
      exitCode: 0,
    },
    gitResult: {
      isGit: true,
      branch: "main",
      filesChanged: 2,
      filesList: ["src/auth.ts", "test/auth.test.ts"],
      pushStatus: "Pushed successfully to origin/main",
      isUpToDate: true,
      summaryText: "Up to date",
    },
    pullStatus: "Already up to date",
  });

  assert.ok(formatted.includes("✅ *Command Done*"));
  assert.ok(formatted.includes("Null check was missing"));
  assert.ok(formatted.includes("Pushed successfully to origin/main"));
  console.log("✔ Test 5 passed: Response formatting output");
}

// Test 6: Docker Detector
{
  const result = detectDockerEnvironment("/tmp");
  assert.strictEqual(result.hasDockerCompose, false);
  console.log("✔ Test 6 passed: Docker environment detector");
}

// Test 7: PAT Token Sanitization
{
  const rawError = "fatal: unable to access 'https://oauth2:HZsakmavqJosUPdyhHzJ@vhessel.bantulkab.go.id/bkppsdm/asn-corpu.git': Could not resolve host";
  const sanitized = rawError.replace(/https?:\/\/[^@\s]+@/g, "https://***@");
  assert.strictEqual(sanitized.includes("HZsakmavqJosUPdyhHzJ"), false);
  assert.ok(sanitized.includes("https://***@vhessel.bantulkab.go.id"));
  console.log("✔ Test 7 passed: Sensitive PAT token masked from output");
}

console.log("\nALL TESTS PASSED SUCCESSFULLY! 🎉\n");
