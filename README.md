# 🐬 Lumba - Autonomous WhatsApp Coding Assistant

**Lumba** is a WhatsApp bot helper that connects to your WhatsApp groups, listens for mentions or quoted messages, navigates to your projects in `/home/zsn/code/`, and runs **OpenCode** autonomously with the **DeepSeek-v4-flash** model in **YOLO mode** (`--auto`).

Before execution, Lumba runs `git pull` to fetch the latest changes; after execution, Lumba commits and runs `git push` to your repository, reporting the bug cause, actions taken, git sync status, and total execution time.

---

## ⚡ Workflow

```
1. User in Group:
   "@lumba corpu please fix the JWT expiration error" 
   (or replies to an error log tagging "@lumba corpu fix this")

2. Lumba:
   Replies "⏳ Command Running... on corpu"

3. Server Automation:
   • Scans /home/zsn/code/ for the "corpu" directory
   • Checks Git branch & runs `git pull`
   • Executes: opencode run --dir /home/zsn/code/corpu -m deepseek/deepseek-v4-flash --auto "<prompt>"
   • Checks git status, creates a commit if files changed, and runs `git push`
   • Checks if origin is up to date

4. Lumba WhatsApp Response:
   ✅ Command Done
   📁 Project: corpu
   ⏱️ Total Execution Time: 38s

   🔍 Bug Cause / Analysis:
   Missing expiry validation check in jwt verify middleware.

   🛠️ Actions Completed:
   - Added token expiration validation in src/auth.ts
   - Added unit test cases

   📦 Git Repository Status:
   • Git Pull: Pulled latest changes on main
   • Files Modified: 2 file(s)
   • Git Push: Pushed successfully to origin/main
   • Codebase Sync: ✅ Up to date with remote
```

---

## 🛠️ Supported Mention Formats

* Standard mention: `@lumba corpu please fix the bug`
* Bracket format: `@Lumba (corpu) add unit test for checkout`
* Square brackets: `@lumba [corpu] update packages`
* Quoted message: Reply to a stack trace or log in WhatsApp with `@lumba corpu fix this` (Lumba automatically extracts the quoted error log into the prompt context!).

---

## 🚀 Running Option 1: Direct Host (Recommended for Local/Server)

Because `opencode`, `git`, and SSH keys are already set up on your machine:

```bash
# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Start the bot
npm start
```

On first run, a QR code will be displayed in the terminal. Open WhatsApp on your phone:
**Settings > Linked Devices > Link a Device** and scan the QR code.

### Run 24/7 with PM2
```bash
npm install -g pm2
pm2 start dist/index.js --name "lumbabot"
pm2 save
```

---

## 🐳 Running Option 2: Docker Compose

Docker packages everything into an isolated container with auto-restart:

```bash
# Start container in detached mode
docker compose up -d

# View the QR code to link your WhatsApp
docker compose logs -f lumba
```

The `docker-compose.yml` mounts:
- `./auth_info_baileys`: Keeps your WhatsApp session persistent across restarts.
- `/home/zsn/code`: Allows OpenCode inside the container to edit projects directly.
- `~/.ssh` and `~/.gitconfig`: Enables seamless `git pull` and `git push` authentication.
- `~/.config/opencode`: Provides OpenCode with your AI credentials.

---

## ⚙️ Configuration (`.env`)

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PROJECTS_BASE_DIR` | Directory where all projects are stored | `/home/zsn/code` |
| `OPENCODE_MODEL` | Model passed to opencode | `deepseek/deepseek-v4-flash` |
| `OPENCODE_FLAGS` | Execution flags (`--auto` for YOLO mode) | `--auto` |
| `BOT_NAME` | Bot trigger keyword | `lumba` |
| `AUTO_PULL` | Run `git pull` before opencode | `true` |
| `AUTO_PUSH` | Auto-commit and run `git push` | `true` |
| `ALLOWED_NUMBERS` | Optional whitelist (comma-separated phone numbers) | Empty (allows group members) |
