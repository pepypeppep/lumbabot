import { CONFIG } from "./config.js";
import { jidNormalizedUser } from "@whiskeysockets/baileys";

export interface ParsedBotCommand {
  isTriggered: boolean;
  isHelp?: boolean;
  projectName?: string;
  prompt?: string;
  sender?: string;
  quotedText?: string;
  fullPrompt?: string;
  reason?: string;
}

export interface ParseMessageOptions {
  botLid?: string;
  isGroup?: boolean;
  isQuotingBot?: boolean;
}

export function parseIncomingMessage(
  rawText: string,
  senderJid: string,
  botJid: string,
  mentionedJids: string[] = [],
  quotedMessageText?: string,
  options?: ParseMessageOptions
): ParsedBotCommand {
  // Normalize JIDs to strip device suffixes (e.g. "6285183096658:12@s.whatsapp.net" -> "6285183096658@s.whatsapp.net")
  const normalizedSenderJid = jidNormalizedUser(senderJid);
  const normalizedBotJid = botJid ? jidNormalizedUser(botJid) : "";
  const normalizedBotLid = options?.botLid ? jidNormalizedUser(options.botLid) : "";

  // Extract phone numbers (without device id)
  const senderNumber = normalizedSenderJid.split("@")[0].replace(/[^0-9]/g, "");
  const botNumber = normalizedBotJid.split("@")[0].replace(/[^0-9]/g, "");
  const botLidNumber = normalizedBotLid ? normalizedBotLid.split("@")[0].replace(/[^0-9]/g, "") : "";

  // 1. Security whitelist check
  if (CONFIG.allowedNumbers.length > 0 && !CONFIG.allowedNumbers.includes(senderNumber)) {
    return { isTriggered: false, reason: `Sender ${senderNumber} not in allowed list` };
  }

  // Clean invisible unicode characters (Left-To-Right mark \u200e, Right-To-Left \u200f, zero-width spaces, etc.)
  // WhatsApp mobile apps frequently wrap @phone mentions with \u200e
  let cleanText = rawText
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g, "")
    .trim();

  // 2. Mention / Trigger check
  // Check if bot was mentioned by JID in contextInfo.mentionedJid
  const isBotMentionedByJid = mentionedJids.some((jid) => {
    const norm = jidNormalizedUser(jid);
    return (
      (normalizedBotJid && norm === normalizedBotJid) ||
      (normalizedBotLid && norm === normalizedBotLid) ||
      (botNumber && norm.split("@")[0].replace(/[^0-9]/g, "") === botNumber) ||
      (botLidNumber && norm.split("@")[0].replace(/[^0-9]/g, "") === botLidNumber)
    );
  });

  // Check if bot name (e.g. "lumba", "Si Lumba", "Si Lumba - Lumba") or phone number is in message text
  const botNamePattern = `@?\\b(si\\s+)?${CONFIG.botName}(\\s*-\\s*${CONFIG.botName})?\\b`;
  const botNameRegex = new RegExp(botNamePattern, "i");
  const mentionsBotName = botNameRegex.test(cleanText);

  const botNumberRegex = botNumber ? new RegExp(`@?\\b${botNumber}\\b`) : null;
  const mentionsBotNumber = botNumberRegex ? botNumberRegex.test(cleanText) : false;

  const isQuotingBot = Boolean(options?.isQuotingBot);
  const isDirectMessage = options?.isGroup === false;

  const isTriggered =
    isBotMentionedByJid ||
    mentionsBotName ||
    mentionsBotNumber ||
    isQuotingBot ||
    isDirectMessage;

  if (!isTriggered) {
    return { isTriggered: false };
  }

  // 3. Clean up the trigger text
  // Remove bot mention by name: e.g. "@lumba", "Si Lumba", "Si Lumba - Lumba"
  cleanText = cleanText.replace(new RegExp(botNamePattern, "gi"), "").trim();

  // Remove phone mention: e.g. "@6285183096658"
  if (botNumber) {
    cleanText = cleanText.replace(new RegExp(`@?\\b${botNumber}\\b`, "g"), "").trim();
  }
  if (botLidNumber) {
    cleanText = cleanText.replace(new RegExp(`@?\\b${botLidNumber}\\b`, "g"), "").trim();
  }

  // Remove leftover leading punctuation / artifacts (e.g. "@Si - ", ":", "-")
  cleanText = cleanText.replace(/^[@:\-,\s]+/, "").trim();

  // 4. Project inquiry or help check (e.g. "berapa project di folder code", "ada berapa project", "list project")
  const isCountQuery = /\b(berapa|jumlah|total|count|how many)\b/i.test(cleanText);
  const isProjectRelated = /\b(project|projects|projek|folder|direktori|repo|code)\b/i.test(cleanText);
  const isListQuery = /\b(list|daftar|apa aja|apa saja|tampilkan|show|semua)\b/i.test(cleanText);
  const isGeneralHelp = !cleanText || ["help", "bantuan", "info", "status", "menu"].includes(cleanText.toLowerCase());

  if (isGeneralHelp || (isCountQuery && isProjectRelated) || (isListQuery && isProjectRelated) || ["projects", "project"].includes(cleanText.toLowerCase())) {
    return {
      isTriggered: true,
      isHelp: true,
      sender: senderNumber,
      reason: isCountQuery ? "Project count requested" : "Project list / help requested",
    };
  }

  // 5. Extract project name and prompt
  // Check if brackets are present anywhere: e.g. "(corpu) fix bug" or "tolong (corpu) fix bug"
  const bracketMatch = cleanText.match(/^[\(\[\{]([a-zA-Z0-9_\-\.]+)[\)\]\}]\s*(.*)$/s);
  let projectName = "";
  let prompt = "";

  if (bracketMatch) {
    projectName = bracketMatch[1].trim();
    prompt = bracketMatch[2].trim();
  } else {
    const inlineBracket = cleanText.match(/[\(\[\{]([a-zA-Z0-9_\-\.]+)[\)\]\}]/);
    if (inlineBracket) {
      projectName = inlineBracket[1].trim();
      prompt = cleanText.replace(inlineBracket[0], "").trim();
    } else {
      const parts = cleanText.split(/\s+/);
      // Skip polite prefix / filler words like "tolong", "coba", "please", "bantu", "mohon"
      let startIndex = 0;
      while (startIndex < parts.length && /^(tolong|coba|bantu|please|pls|mohon|cek|di)$/i.test(parts[startIndex])) {
        startIndex++;
      }

      const candidateParts = parts.slice(startIndex);
      if (candidateParts.length > 0) {
        // If candidate starts with "project" or "projek" e.g. "project corpu fix auth"
        if (/^(project|projek)$/i.test(candidateParts[0]) && candidateParts.length > 1) {
          projectName = candidateParts[1].replace(/[\(\)\[\]\{\}]/g, "").trim();
          prompt = candidateParts.slice(2).join(" ").trim();
        } else {
          projectName = candidateParts[0].replace(/[\(\)\[\]\{\}]/g, "").trim();
          prompt = candidateParts.slice(1).join(" ").trim();
        }
      }
    }
  }

  if (!projectName) {
    return {
      isTriggered: true,
      isHelp: true,
      sender: senderNumber,
      reason: "Missing project name",
    };
  }

  // If there's a quoted message (e.g. user replied to a stack trace or code snippet)
  let fullPrompt = prompt;
  if (quotedMessageText && quotedMessageText.trim()) {
    fullPrompt = prompt
      ? `${prompt}\n\n--- Quoted Message / Context ---\n${quotedMessageText.trim()}`
      : quotedMessageText.trim();
  }

  if (!fullPrompt.trim()) {
    fullPrompt = "Please analyze this project, inspect git status, and check for any bugs or pending issues.";
  }

  return {
    isTriggered: true,
    isHelp: false,
    projectName,
    prompt,
    sender: senderNumber,
    quotedText: quotedMessageText,
    fullPrompt,
  };
}

