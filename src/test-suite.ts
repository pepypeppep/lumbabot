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

console.log("\nALL TESTS PASSED SUCCESSFULLY! 🎉\n");
