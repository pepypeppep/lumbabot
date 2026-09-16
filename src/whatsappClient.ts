import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import qrcode from "qrcode-terminal";
import path from "node:path";
import fs from "node:fs";

import { CONFIG } from "./config.js";
import { parseIncomingMessage } from "./messageParser.js";
import { scanProjectDirectory } from "./projectScanner.js";
import { preExecutionGitSync, postExecutionGitSync } from "./gitManager.js";
import { runOpenCode } from "./opencodeRunner.js";
import {
  formatCommandDoneMessage,
  formatRunningMessage,
  formatProjectNotFoundMessage,
} from "./responseFormatter.js";

// Concurrency lock to avoid overlapping edits on the same project
const activeLocks = new Set<string>();

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
      const botNumber = sock.user?.id.split(":")[0] || "Unknown";
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

      const senderJid = msg.key.participant || remoteJid;
      const botJid = sock.user?.id || "";

      // Extract message text
      const rawText =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "";

      if (!rawText.trim()) continue;

      // Extract mentions & quoted message
      const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
      const mentionedJids: string[] = contextInfo?.mentionedJid || [];
      const quotedMessage = contextInfo?.quotedMessage;
      const quotedText =
        (quotedMessage?.conversation ||
        quotedMessage?.extendedTextMessage?.text ||
        quotedMessage?.imageMessage?.caption) || undefined;

      // Parse trigger
      const parsed = parseIncomingMessage(
        rawText,
        senderJid,
        botJid,
        mentionedJids,
        quotedText
      );

      if (!parsed.isTriggered) continue;

      if (!parsed.projectName) {
        if (parsed.reason) {
          await sock.sendMessage(
            remoteJid,
            { text: `⚠️ ${parsed.reason}` },
            { quoted: msg }
          );
        }
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
    // 3. Send initial acknowledge "Command Running..."
    const runningMsg = formatRunningMessage(canonicalName, parsed.prompt || prompt);
    await sock.sendMessage(remoteJid, { text: runningMsg }, { quoted: msg });

    // 4. Pre-execution Git pull
    console.log(`[Lumba] Performing pre-execution git pull on ${projectPath}...`);
    const preGit = await preExecutionGitSync(projectPath);
    console.log(`[Lumba] Git pull result: ${preGit.pullStatus}`);

    // 5. Run OpenCode in YOLO mode with deepseek-v4-flash
    console.log(`[Lumba] Executing OpenCode on ${projectPath}...`);
    const opencodeResult = await runOpenCode(projectPath, prompt);
    console.log(`[Lumba] OpenCode finished in ${opencodeResult.durationFormatted}. Exit code: ${opencodeResult.exitCode}`);

    // 6. Post-execution Git status, commit, and git push
    console.log(`[Lumba] Performing post-execution git commit & push on ${projectPath}...`);
    const postGit = await postExecutionGitSync(projectPath, parsed.prompt || "Auto-fix");
    console.log(`[Lumba] Git push result: ${postGit.pushStatus}`);

    // 7. Format final response
    const finalReport = formatCommandDoneMessage({
      projectName: canonicalName,
      projectPath,
      opencodeResult,
      gitResult: postGit,
      pullStatus: preGit.pullStatus,
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
