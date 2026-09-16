import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WAMessage,
  jidNormalizedUser,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import path from "node:path";
import fs from "node:fs";

import { CONFIG } from "./config.js";
import { parseIncomingMessage } from "./messageParser.js";
import { scanProjectDirectory, getAvailableProjects } from "./projectScanner.js";
import {
  preExecutionGitSync,
  postExecutionGitSync,
  executeGitPull,
  executeGitPush,
  executeGitStatus,
  getWorkingTreeStatus,
} from "./gitManager.js";
import { runOpenCode } from "./opencodeRunner.js";
import {
  formatCommandDoneMessage,
  formatRunningMessage,
  formatProjectNotFoundMessage,
  formatHelpMessage,
  formatGitPullMessage,
  formatGitPushMessage,
  formatGitStatusMessage,
} from "./responseFormatter.js";

// Concurrency lock to avoid overlapping edits on the same project
const activeLocks = new Set<string>();

// Helper to unwrap ephemeral, viewOnce, or wrapped messages
function getRealMessage(message: any): any {
  if (!message) return null;
  let current = message;
  while (
    current?.ephemeralMessage?.message ||
    current?.viewOnceMessage?.message ||
    current?.viewOnceMessageV2?.message ||
    current?.documentWithCaptionMessage?.message
  ) {
    current =
      current?.ephemeralMessage?.message ||
      current?.viewOnceMessage?.message ||
      current?.viewOnceMessageV2?.message ||
      current?.documentWithCaptionMessage?.message;
  }
  return current;
}

export async function startWhatsAppClient() {
  const sessionPath = path.resolve(CONFIG.authSessionDir);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`[Lumba] Starting WhatsApp Client (Baileys v${version.join(".")}, latest: ${isLatest})`);
  console.log(`[Lumba] Projects Base Directory: ${CONFIG.projectsBaseDir}`);
  console.log(`[Lumba] OpenCode Model: ${CONFIG.opencodeModel}`);
  console.log(`[Lumba] OpenCode Flags: ${CONFIG.opencodeFlags.join(" ")} (YOLO auto-approval mode)`);

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n=======================================================");
      console.log("📱 SCAN THIS QR CODE WITH WHATSAPP (LINKED DEVICES)");
      console.log("=======================================================\n");
      qrcode.generate(qr, { small: true });
      console.log("\nOpen WhatsApp > Linked Devices > Link a Device > Scan QR");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[Lumba] Connection closed. Reason: ${statusCode}, Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(startWhatsAppClient, 4000);
      } else {
        console.log("[Lumba] Logged out. Delete auth folder and rescan QR code to reconnect.");
      }
    } else if (connection === "open") {
      const botNumber = sock.user?.id ? jidNormalizedUser(sock.user.id).split("@")[0] : "Unknown";
      console.log(`\n🎉 [Lumba] Bot successfully connected as @${botNumber}!`);
      console.log(`[Lumba] Ready to receive commands in groups and chats.`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Ignore bot's own messages
      if (msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) continue;

      const isGroup = remoteJid.endsWith("@g.us");
      const senderJid = msg.key.participant || remoteJid;
      const botJid = sock.user?.id || "";
      const botLid = sock.user?.lid || "";

      // Unwrap ephemeral / viewOnce messages if group has disappearing messages enabled
      const realMessage = getRealMessage(msg.message);
      if (!realMessage) continue;

      // Extract message text
      const rawText =
        realMessage.conversation ||
        realMessage.extendedTextMessage?.text ||
        realMessage.imageMessage?.caption ||
        realMessage.videoMessage?.caption ||
        realMessage.documentMessage?.caption ||
        "";

      if (!rawText.trim()) continue;

      // Extract mentions & quoted message
      const contextInfo =
        realMessage.extendedTextMessage?.contextInfo ||
        realMessage.imageMessage?.contextInfo ||
        realMessage.videoMessage?.contextInfo ||
        realMessage.documentMessage?.contextInfo;

      const mentionedJids: string[] = contextInfo?.mentionedJid || [];
      const quotedMsgRaw = contextInfo?.quotedMessage ? getRealMessage(contextInfo.quotedMessage) : undefined;
      const quotedText =
        quotedMsgRaw?.conversation ||
        quotedMsgRaw?.extendedTextMessage?.text ||
        quotedMsgRaw?.imageMessage?.caption ||
        quotedMsgRaw?.videoMessage?.caption ||
        quotedMsgRaw?.documentMessage?.caption ||
        undefined;

      const quotedParticipant = contextInfo?.participant;
      const botNormalizedJid = botJid ? jidNormalizedUser(botJid) : "";
      const botNormalizedLid = botLid ? jidNormalizedUser(botLid) : "";

      const isQuotingBot = Boolean(
        quotedParticipant &&
        ((botNormalizedJid && jidNormalizedUser(quotedParticipant) === botNormalizedJid) ||
         (botNormalizedLid && jidNormalizedUser(quotedParticipant) === botNormalizedLid))
      );

      // Parse trigger
      const parsed = parseIncomingMessage(
        rawText,
        senderJid,
        botJid,
        mentionedJids,
        quotedText,
        {
          botLid,
          isGroup,
          isQuotingBot,
        }
      );

      if (!parsed.isTriggered) {
        if (parsed.reason) {
          console.log(`[Lumba] Ignored message from ${senderJid}: ${parsed.reason}`);
        }
        continue;
      }

      console.log(`[Lumba] Triggered by ${parsed.sender} in ${remoteJid}: "${rawText.slice(0, 60)}"`);

      // If help was requested or no project name was provided
      if (parsed.isHelp || !parsed.projectName) {
        console.log(`[Lumba] Sending help / project list to ${remoteJid}...`);
        const available = getAvailableProjects(CONFIG.projectsBaseDir);
        const helpMessage = formatHelpMessage(available, CONFIG.projectsBaseDir);
        await sock.sendMessage(remoteJid, { text: helpMessage }, { quoted: msg });
        continue;
      }

      // Handle the command asynchronously
      handleCommand(sock, remoteJid, msg, parsed);
    }
  });

  return sock;
}

async function handleCommand(
  sock: any,
  remoteJid: string,
  msg: WAMessage,
  parsed: ReturnType<typeof parseIncomingMessage>
) {
  const targetName = parsed.projectName!;
  const prompt = parsed.fullPrompt || parsed.prompt || "";

  console.log(`\n[Lumba] Received command for project "${targetName}" from ${parsed.sender}`);

  // 1. Scan and find project directory inside /home/zsn/code/
  const scan = scanProjectDirectory(targetName);
  if (!scan.found || !scan.projectPath) {
    const errorReply = formatProjectNotFoundMessage(
      targetName,
      CONFIG.projectsBaseDir,
      scan.availableProjects || []
    );
    await sock.sendMessage(remoteJid, { text: errorReply }, { quoted: msg });
    return;
  }

  const projectPath = scan.projectPath;
  const canonicalName = scan.projectName || targetName;

  // 2. Concurrency Lock check
  if (activeLocks.has(projectPath)) {
    await sock.sendMessage(
      remoteJid,
      {
        text: `⏳ *Project Busy*\nAnother command is already running on *${canonicalName}*. Please wait for it to finish.`,
      },
      { quoted: msg }
    );
    return;
  }

  activeLocks.add(projectPath);

  try {
    // Check if this is a dedicated Git command (pull / push / status)
    if (parsed.gitCommand) {
      const gitCmd = parsed.gitCommand;
      console.log(`[Lumba] Handling git ${gitCmd.action} for project "${canonicalName}"...`);

      if (gitCmd.action === "pull") {
        const pullResult = await executeGitPull(projectPath, gitCmd.args);
        const reply = formatGitPullMessage(canonicalName, pullResult);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }

      if (gitCmd.action === "push") {
        const pushResult = await executeGitPush(projectPath, gitCmd.args);
        const reply = formatGitPushMessage(canonicalName, pushResult);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }

      if (gitCmd.action === "status") {
        const statusResult = await executeGitStatus(projectPath);
        const reply = formatGitStatusMessage(canonicalName, statusResult);
        await sock.sendMessage(remoteJid, { text: reply }, { quoted: msg });
        return;
      }
    }

    // 3. Normal OpenCode command: Send initial acknowledge "Command Running..."
    const runningMsg = formatRunningMessage(canonicalName, parsed.prompt || prompt);
    await sock.sendMessage(remoteJid, { text: runningMsg }, { quoted: msg });

    // 4. Pre-execution Git pull (ONLY if CONFIG.autoPull is explicitly enabled)
    let preGitPullStatus = "Skipped";
    if (CONFIG.autoPull) {
      console.log(`[Lumba] Auto-pull enabled: Performing pre-execution git pull on ${projectPath}...`);
      const preGit = await preExecutionGitSync(projectPath);
      preGitPullStatus = preGit.pullStatus;
      console.log(`[Lumba] Git pull result: ${preGitPullStatus}`);
    } else {
      console.log(`[Lumba] Skipping git pull before execution (auto-pull disabled).`);
    }

    // 5. Run OpenCode in YOLO mode with configured model
    console.log(`[Lumba] Executing OpenCode on ${projectPath}...`);
    const opencodeResult = await runOpenCode(projectPath, prompt);
    console.log(`[Lumba] OpenCode finished in ${opencodeResult.durationFormatted}. Exit code: ${opencodeResult.exitCode}`);

    // 6. Post-execution Git status (ONLY commit & push if CONFIG.autoPush is explicitly enabled AND OpenCode succeeded)
    let postGit: any;
    if (CONFIG.autoPush && opencodeResult.success) {
      console.log(`[Lumba] Auto-push enabled: Performing post-execution git commit & push on ${projectPath}...`);
      postGit = await postExecutionGitSync(projectPath, parsed.prompt || "Auto-fix");
      console.log(`[Lumba] Git push result: ${postGit.pushStatus}`);
    } else {
      console.log(`[Lumba] Skipping git push (auto-push disabled or execution failed). Inspecting working tree status...`);
      postGit = await getWorkingTreeStatus(projectPath);
    }

    // 7. Format final response
    const finalReport = formatCommandDoneMessage({
      projectName: canonicalName,
      projectPath,
      opencodeResult,
      gitResult: postGit,
      pullStatus: preGitPullStatus,
    });

    // 8. Reply back to the user
    await sock.sendMessage(remoteJid, { text: finalReport }, { quoted: msg });
  } catch (err: any) {
    console.error(`[Lumba] Execution error:`, err);
    await sock.sendMessage(
      remoteJid,
      {
        text: `❌ *Execution Error*\nFailed during execution on *${canonicalName}*:\n\`\`\`${err.message}\`\`\``,
      },
      { quoted: msg }
    );
  } finally {
    activeLocks.delete(projectPath);
  }
}
