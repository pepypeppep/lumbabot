import { startWhatsAppClient } from "./whatsappClient.js";

async function main() {
  console.log("==================================================");
  console.log("               LUMBA BOT STARTING                 ");
  console.log("==================================================");

  try {
    await startWhatsAppClient();
  } catch (error) {
    console.error("Fatal error starting Lumba Bot:", error);
    process.exit(1);
  }
}

// Handle termination signals gracefully
process.on("SIGINT", () => {
  console.log("\n[Lumba] Shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Lumba] Terminating...");
  process.exit(0);
});

main();
