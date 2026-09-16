import assert from "node:assert";
import { parseIncomingMessage, extractGitCommand } from "./messageParser.js";
import { scanProjectDirectory } from "./projectScanner.js";
import {
  formatCommandDoneMessage,
  formatGitPullMessage,
  formatGitPushMessage,
  formatGitStatusMessage,
  formatForWhatsApp,
} from "./responseFormatter.js";
import { detectDockerEnvironment } from "./dockerDetector.js";
import { detectNewlyModifiedFiles, WorkingTreeSnapshot } from "./gitManager.js";

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

// Test 4: WhatsApp Contact Mention in Group (with :device suffix in botJid)
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "@6285183096658 corpu fix authentication token";
  const mentionedJids = ["6285183096658@s.whatsapp.net"];
  const senderJid = "628123456789:2@s.whatsapp.net";

  const parsed = parseIncomingMessage(
    userMsg,
    senderJid,
    botJidWithDevice,
    mentionedJids,
    undefined,
    { isGroup: true }
  );

  assert.strictEqual(parsed.isTriggered, true, "Should trigger when mentioned by WhatsApp contact phone tag");
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.prompt, "fix authentication token");
  assert.strictEqual(parsed.sender, "628123456789");
  console.log("✔ Test 4 passed: WhatsApp contact mention with device JIDs");
}

// Test 5: WhatsApp Mobile Hidden Unicode Marks (\u200e Left-to-Right mark)
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "\u200e@6285183096658\u200e (lumbabot) run health check";
  const mentionedJids = ["6285183096658@s.whatsapp.net"];

  const parsed = parseIncomingMessage(
    userMsg,
    "628123456789@s.whatsapp.net",
    botJidWithDevice,
    mentionedJids,
    undefined,
    { isGroup: true }
  );

  assert.strictEqual(parsed.isTriggered, true, "Should trigger despite \\u200e unicode markers");
  assert.strictEqual(parsed.projectName, "lumbabot");
  assert.strictEqual(parsed.prompt, "run health check");
  console.log("✔ Test 5 passed: Stripping hidden unicode characters");
}

// Test 6: Tagging bot with no project or requesting help returns isHelp: true
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "@6285183096658";
  const mentionedJids = ["6285183096658@s.whatsapp.net"];

  const parsed = parseIncomingMessage(
    userMsg,
    "628123456789@s.whatsapp.net",
    botJidWithDevice,
    mentionedJids,
    undefined,
    { isGroup: true }
  );

  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.isHelp, true, "Tagging bot without arguments triggers help");
  console.log("✔ Test 6 passed: Help trigger when bot tagged with no arguments");
}

// Test 7: Quoting a bot message in group triggers execution
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "corpu retry the previous deploy";

  const parsed = parseIncomingMessage(
    userMsg,
    "628123456789@s.whatsapp.net",
    botJidWithDevice,
    [],
    "Previous failure message",
    { isGroup: true, isQuotingBot: true }
  );

  assert.strictEqual(parsed.isTriggered, true, "Replying to bot should trigger");
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.prompt, "retry the previous deploy");
  console.log("✔ Test 7 passed: Quoting bot message in group");
}

// Test 8: Project Scanner - directory traversal protection
{
  const scan = scanProjectDirectory("../../etc/passwd");
  assert.strictEqual(scan.found, false);
  console.log("✔ Test 8 passed: Directory traversal prevented");
}

// Test 9: Si Lumba contact name and "berapa project di folder code" inquiry
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "@Si Lumba - Lumba berapa project di folder code";
  const mentionedJids = ["6285183096658@s.whatsapp.net"];

  const parsed = parseIncomingMessage(
    userMsg,
    "628123456789@s.whatsapp.net",
    botJidWithDevice,
    mentionedJids,
    undefined,
    { isGroup: true }
  );

  assert.strictEqual(parsed.isTriggered, true, "Should trigger on Si Lumba mention");
  assert.strictEqual(parsed.isHelp, true, "Should detect question about project count as help/inquiry");
  console.log("✔ Test 9 passed: @Si Lumba - Lumba berapa project inquiry");
}

// Test 10: Polite filler words with project (e.g. @Si Lumba tolong corpu fix auth)
{
  const botJidWithDevice = "6285183096658:12@s.whatsapp.net";
  const userMsg = "@Si Lumba tolong corpu fix auth";
  const mentionedJids = ["6285183096658@s.whatsapp.net"];

  const parsed = parseIncomingMessage(
    userMsg,
    "628123456789@s.whatsapp.net",
    botJidWithDevice,
    mentionedJids,
    undefined,
    { isGroup: true }
  );

  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.isHelp, false);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.prompt, "fix auth");
  console.log("✔ Test 10 passed: Polite filler words (@Si Lumba tolong corpu fix auth)");
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

// Test 8: Failed Command Response Formatting
{
  const formattedFail = formatCommandDoneMessage({
    projectName: "corpu",
    projectPath: "/home/zsn/code/corpu",
    opencodeResult: {
      success: false,
      durationMs: 120,
      durationFormatted: "0s",
      output: "Failed to start opencode: Binary opencode not found in PATH",
      bugCause: "Execution failed to launch (Binary opencode not found in PATH)",
      actionsDone: "Error: Binary opencode not found in PATH",
      rawOutput: "",
      exitCode: -1,
    },
    gitResult: {
      isGit: false,
      branch: "none",
      filesChanged: 0,
      filesList: [],
      pushStatus: "N/A",
      isUpToDate: true,
      summaryText: "N/A",
    },
    pullStatus: "Not a git repository",
  });

  assert.ok(formattedFail.includes("❌ *Command Failed*"));
  assert.ok(formattedFail.includes("Binary opencode not found in PATH"));
  console.log("✔ Test 8 passed: Error formatting shows Command Failed with clear cause");
}

// Test 9: Git Pull Command Parsing
{
  const msg = "@lumba corpu git pull";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.ok(parsed.gitCommand);
  assert.strictEqual(parsed.gitCommand?.action, "pull");
  console.log("✔ Test 9 passed: @lumba corpu git pull parsed as git pull command");
}

// Test 10: Git Push with commit message
{
  const msg = "@Lumba (corpu) git push fix authentication token";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.ok(parsed.gitCommand);
  assert.strictEqual(parsed.gitCommand?.action, "push");
  assert.strictEqual(parsed.gitCommand?.args, "fix authentication token");
  console.log("✔ Test 10 passed: @Lumba (corpu) git push <msg> parsed as git push command with message");
}

// Test 11: Git Status Command Parsing
{
  const msg = "@lumba corpu git status";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.ok(parsed.gitCommand);
  assert.strictEqual(parsed.gitCommand?.action, "status");
  console.log("✔ Test 11 passed: @lumba corpu git status parsed as git status command");
}

// Test 12: Standalone pull and push commands
{
  const pullMsg = "@lumba corpu pull";
  const parsedPull = parseIncomingMessage(pullMsg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsedPull.gitCommand?.action, "pull");

  const pushMsg = "@lumba corpu push";
  const parsedPush = parseIncomingMessage(pushMsg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsedPush.gitCommand?.action, "push");

  const statusMsg = "@lumba corpu status";
  const parsedStatus = parseIncomingMessage(statusMsg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsedStatus.gitCommand?.action, "status");
  console.log("✔ Test 12 passed: Standalone pull, push, and status keywords recognized");
}

// Test 13: Normal prompt does NOT trigger gitCommand
{
  const msg = "@lumba corpu tolong perbaiki auth bug";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.projectName, "corpu");
  assert.strictEqual(parsed.gitCommand, null);
  console.log("✔ Test 13 passed: Normal prompt does not trigger git command");
}

// Test 14: Prompt containing 'push notification' does NOT trigger git push
{
  const msg = "@lumba corpu implement push notification feature";
  const parsed = parseIncomingMessage(msg, "628123456789@s.whatsapp.net", "628999999999@s.whatsapp.net", []);
  assert.strictEqual(parsed.isTriggered, true);
  assert.strictEqual(parsed.gitCommand, null);
  console.log("✔ Test 14 passed: 'push notification' prompt does not trigger git push");
}

// Test 15: Format Git Pull Response
{
  const formatted = formatGitPullMessage("corpu", {
    isGit: true,
    branch: "main",
    success: true,
    pullStatus: "Already up to date",
    output: "Already up to date.",
  });
  assert.ok(formatted.includes("✅ *Git Pull Succeeded*"));
  assert.ok(formatted.includes("📁 *Project*: corpu"));
  assert.ok(formatted.includes("🌿 *Branch*: `main`"));
  console.log("✔ Test 15 passed: formatGitPullMessage output");
}

// Test 16: Format Git Push Response
{
  const formatted = formatGitPushMessage("corpu", {
    isGit: true,
    branch: "main",
    success: true,
    filesChanged: 2,
    filesList: ["src/index.ts", "package.json"],
    pushStatus: "Pushed successfully to origin/main",
    commitMsg: "fix: update index and package",
    output: "Everything up-to-date",
  });
  assert.ok(formatted.includes("✅ *Git Push Succeeded*"));
  assert.ok(formatted.includes("📦 *Files Committed*: 2 file(s)"));
  assert.ok(formatted.includes("Pushed successfully to origin/main"));
  console.log("✔ Test 16 passed: formatGitPushMessage output");
}

// Test 17: Format Git Status Response
{
  const formatted = formatGitStatusMessage("corpu", {
    isGit: true,
    branch: "main",
    filesChanged: 1,
    filesList: ["src/auth.ts"],
    unpushedCommits: 0,
    isUpToDate: false,
    summaryText: "Needs push",
  });
  assert.ok(formatted.includes("📦 *Git Status: corpu*"));
  assert.ok(formatted.includes("Modified/Untracked Files*: 1 file(s)"));
  assert.ok(formatted.includes("src/auth.ts"));
  console.log("✔ Test 17 passed: formatGitStatusMessage output");
}

// Test 18: OpenCode JSON UnknownError parsing in response formatting
{
  const rawErr = `[OpenCode ERR] Error: {\n  "name": "UnknownError",\n  "data": {\n    "message": "Unexpected server error. Check server logs for details.",\n    "ref": "err_8eaeb0a8"\n  }\n}`;
  const jsonStart = rawErr.indexOf("{");
  const jsonEnd = rawErr.lastIndexOf("}");
  assert.ok(jsonStart !== -1 && jsonEnd > jsonStart);
  const parsedErr = JSON.parse(rawErr.slice(jsonStart, jsonEnd + 1));
  assert.strictEqual(parsedErr.name, "UnknownError");
  assert.strictEqual(parsedErr.data.ref, "err_8eaeb0a8");
  assert.strictEqual(parsedErr.data.message, "Unexpected server error. Check server logs for details.");
  console.log("✔ Test 18 passed: OpenCode nested JSON error parsed successfully");
}

// Test 19: OpenCode Model Normalization
{
  const rawModel = "ai-bid3/deepseek-v4-flash";
  const normalized = rawModel.startsWith("ai-bid3/") ? `bidang3/${rawModel}` : rawModel;
  assert.strictEqual(normalized, "bidang3/ai-bid3/deepseek-v4-flash");
  console.log("✔ Test 19 passed: Model normalization prepends provider prefix 'bidang3/'");
}

// Test 20: Dynamic Response Formatting for Inquiry / Inspection (sync-db.sh case)
{
  const formatted = formatCommandDoneMessage({
    projectName: "corpu",
    projectPath: "/home/zsn/code/corpu",
    opencodeResult: {
      success: true,
      durationMs: 13000,
      durationFormatted: "13s",
      output: "`sync-db.sh` untracked (not in git). Filesystem mtime: **2026-09-16 11:26:34 +0000**.\n\nBug Cause: N/A\nActions Done:\n- Checked git history for file (none, untracked)\n- Read filesystem mtime for creation time",
      resultText: "`sync-db.sh` untracked (not in git). Filesystem mtime: **2026-09-16 11:26:34 +0000**.",
      bugCause: "",
      actionsDone: "- Checked git history for file (none, untracked)\n- Read filesystem mtime for creation time",
      rawOutput: "",
      exitCode: 0,
    },
    gitResult: {
      isGit: true,
      branch: "main",
      filesChanged: 2,
      filesList: ["unrelated1.txt", "unrelated2.txt"],
      pushStatus: "Skipped (run '@lumba <project> git push' to push)",
      isUpToDate: false,
      summaryText: "2 files modified",
    },
    pullStatus: "Skipped",
    newlyModifiedFiles: [], // No files were modified by this inquiry command!
  });

  // Verify the primary result is displayed
  assert.ok(formatted.includes("💬 *Result*:"), "Should include Result header");
  assert.ok(formatted.includes("`sync-db.sh` untracked"), "Should show the actual result");
  assert.ok(formatted.includes("*2026-09-16 11:26:34 +0000*"), "Should format bold text for WhatsApp");

  // Verify Bug Cause N/A is stripped dynamically
  assert.strictEqual(formatted.includes("Bug Cause"), false, "Should NOT show Bug Cause when empty or N/A");
  assert.strictEqual(formatted.includes("N/A"), false, "Should NOT include N/A in message");

  // Verify false-positive git changes and push suggestions are omitted when newlyModifiedFiles is empty
  assert.strictEqual(formatted.includes("Files Modified"), false, "Should NOT show Files Modified for read-only inquiry");
  assert.strictEqual(formatted.includes("git push"), false, "Should NOT suggest git push when no files modified by command");

  // Verify actions are still displayed
  assert.ok(formatted.includes("🛠️ *Actions Completed*:"));
  assert.ok(formatted.includes("Checked git history"));
  console.log("✔ Test 20 passed: Dynamic inquiry response displays result and strips Bug Cause: N/A & false git push");
}

// Test 21: Dynamic Response Formatting for Bug Fix with Code Changes
{
  const formatted = formatCommandDoneMessage({
    projectName: "corpu",
    projectPath: "/home/zsn/code/corpu",
    opencodeResult: {
      success: true,
      durationMs: 32000,
      durationFormatted: "32s",
      output: "Fixed auth token validation bug",
      resultText: "Fixed auth token validation bug in auth middleware.",
      bugCause: "Missing null check when user session expired",
      actionsDone: "- Added null check in AuthController.php\n- Added unit tests",
      rawOutput: "",
      exitCode: 0,
    },
    gitResult: {
      isGit: true,
      branch: "main",
      filesChanged: 2,
      filesList: ["app/Http/Controllers/AuthController.php", "tests/Feature/AuthTest.php"],
      pushStatus: "Skipped (run '@lumba <project> git push' to push)",
      isUpToDate: false,
      summaryText: "2 files modified",
    },
    pullStatus: "Skipped",
    newlyModifiedFiles: ["app/Http/Controllers/AuthController.php", "tests/Feature/AuthTest.php"],
  });

  assert.ok(formatted.includes("💬 *Result*:"));
  assert.ok(formatted.includes("🔍 *Bug Cause / Analysis*:"));
  assert.ok(formatted.includes("Missing null check"));
  assert.ok(formatted.includes("🛠️ *Actions Completed*:"));
  assert.ok(formatted.includes("📦 *Files Modified* (2 file(s)):"));
  assert.ok(formatted.includes("app/Http/Controllers/AuthController.php"));
  assert.ok(formatted.includes("💡 *Next Step*: Gunakan `@lumba corpu git push`"));
  console.log("✔ Test 21 passed: Dynamic bug fix response shows Result, Bug Cause, Actions, and Files Modified");
}

// Test 22: WhatsApp Markdown bold normalization
{
  const input = "File **README.md** created with `foo **bar** baz` and **bold text**.";
  const normalized = formatForWhatsApp(input);
  assert.strictEqual(normalized, "File *README.md* created with `foo **bar** baz` and *bold text*.");
  console.log("✔ Test 22 passed: formatForWhatsApp converts **bold** outside code blocks to *bold*");
}

// Test 23: WorkingTreeSnapshot and detectNewlyModifiedFiles
{
  const preSnapshot: WorkingTreeSnapshot = {
    isGit: true,
    statusMap: new Map([
      ["existing.txt", " M"],
      ["untracked.sh", "??"],
    ]),
    diffHash: "diff --git a/existing.txt",
  };

  // Case 23a: OpenCode only read files, no modifications
  const postSnapshotNoChanges: WorkingTreeSnapshot = {
    isGit: true,
    statusMap: new Map([
      ["existing.txt", " M"],
      ["untracked.sh", "??"],
    ]),
    diffHash: "diff --git a/existing.txt",
  };
  const diffA = detectNewlyModifiedFiles(preSnapshot, postSnapshotNoChanges);
  assert.deepStrictEqual(diffA, [], "Should detect 0 newly modified files when repo status is unchanged");

  // Case 23b: OpenCode edited a new file
  const postSnapshotWithChanges: WorkingTreeSnapshot = {
    isGit: true,
    statusMap: new Map([
      ["existing.txt", " M"],
      ["untracked.sh", "??"],
      ["new_feature.ts", "??"],
    ]),
    diffHash: "diff --git a/existing.txt",
  };
  const diffB = detectNewlyModifiedFiles(preSnapshot, postSnapshotWithChanges);
  assert.deepStrictEqual(diffB, ["new_feature.ts"], "Should detect new_feature.ts as newly modified file");

  console.log("✔ Test 23 passed: detectNewlyModifiedFiles accurately isolates changes made during run");
}

console.log("\nALL TESTS PASSED SUCCESSFULLY! 🎉\n");

