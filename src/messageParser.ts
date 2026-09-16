import { CONFIG } from "./config.js";

export interface ParsedBotCommand {
  isTriggered: boolean;
  projectName?: string;
  prompt?: string;
  sender?: string;
  quotedText?: string;
  fullPrompt?: string;
  reason?: string;
}

export function parseIncomingMessage(
  rawText: string,
  senderJid: string,
  botJid: string,
  mentionedJids: string[] = [],
  quotedMessageText?: string
): ParsedBotCommand {
  const senderNumber = senderJid.split("@")[0].replace(/[^0-9]/g, "");
  const botNumber = botJid.split("@")[0].replace(/[^0-9]/g, "");

  // 1. Security whitelist check
  if (CONFIG.allowedNumbers.length > 0 && !CONFIG.allowedNumbers.includes(senderNumber)) {
    return { isTriggered: false, reason: "Sender not in allowed list" };
  }

  // 2. Mention check
  const isBotMentionedByJid = mentionedJids.some((jid) => jid.includes(botNumber));
  const botNameRegex = new RegExp(`^@?${CONFIG.botName}\\b`, "i");
  const mentionsBotName = botNameRegex.test(rawText.trim());

  if (!isBotMentionedByJid && !mentionsBotName) {
    return { isTriggered: false };
  }

  // 3. Clean up the trigger text
  // Remove bot mention: e.g. "@lumba" or "@628xxxx"
  let cleanText = rawText.trim();
  cleanText = cleanText.replace(botNameRegex, "").trim();

  // If phone mention was used like @123456789
  const phoneMentionRegex = new RegExp(`^@?${botNumber}\\b`, "i");
  cleanText = cleanText.replace(phoneMentionRegex, "").trim();

  // 4. Extract project name and prompt
  // Pattern: (projectName) prompt OR [projectName] prompt OR projectName prompt
  // Examples:
  // "corpu please fix this bug" -> project: "corpu", prompt: "please fix this bug"
  // "(corpu) fix bug" -> project: "corpu", prompt: "fix bug"
  const bracketMatch = cleanText.match(/^[\(\[\{]([a-zA-Z0-9_\-\.]+)[\)\]\}]\s*(.*)$/s);
  let projectName = "";
  let prompt = "";

  if (bracketMatch) {
    projectName = bracketMatch[1].trim();
    prompt = bracketMatch[2].trim();
  } else {
    // Space-separated: first word is project name
    const parts = cleanText.split(/\s+/);
    projectName = parts[0] ? parts[0].replace(/[\(\)\[\]\{\}]/g, "").trim() : "";
    prompt = parts.slice(1).join(" ").trim();
  }

  if (!projectName) {
    return {
      isTriggered: true,
      reason: "Missing project name. Format: @lumba <project_name> <prompt>",
    };
  }

  // If there's a quoted message (e.g. user replied to a stack trace or code snippet)
  let fullPrompt = prompt;
  if (quotedMessageText && quotedMessageText.trim()) {
    fullPrompt = `${prompt}\n\n--- Quoted Message / Context ---\n${quotedMessageText.trim()}`;
  }

  if (!fullPrompt.trim()) {
    fullPrompt = "Please analyze this project, inspect git status, and check for any bugs or pending issues.";
  }

  return {
    isTriggered: true,
    projectName,
    prompt,
    sender: senderNumber,
    quotedText: quotedMessageText,
    fullPrompt,
  };
}
