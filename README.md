# 🐬 Lumba - Autonomous WhatsApp Coding Assistant

**Lumba** is a WhatsApp bot helper that connects to your WhatsApp groups, listens for mentions or quoted messages, navigates to your projects in `/home/zsn/code/`, and runs **OpenCode** autonomously with the **DeepSeek-v4-flash** model in **YOLO mode** (`--auto`).

Git operations (`git pull`, `git push`, and `git status`) are separate commands that you run on-demand, allowing you to execute AI prompts without pulling or pushing automatically.

---

## ⚡ Workflow

### 1. Running an AI Prompt (Without auto pull/push)
```
1. User in Group:
   "@lumba corpu please fix the JWT expiration error" 
   (or replies to an error log tagging "@lumba corpu fix this")

2. Lumba:
   Replies "⏳ Command Running... on corpu"

3. Server Automation:
   • Scans /home/zsn/code/ for the "corpu" directory
   • Executes: opencode run --dir /home/zsn/code/corpu -m deepseek/deepseek-v4-flash --auto "<prompt>"
   • Inspects files modified in working tree

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
   • Files Modified: 2 file(s)
   💡 Next Step: Gunakan `@lumba corpu git push` untuk commit & push perubahan.
```

### 2. Running Separate Git Commands
```
• Pull latest changes:
  "@lumba corpu git pull"

• Commit & Push changes:
  "@lumba corpu git push fix auth error"
  (or simply "@lumba corpu git push")

• Check repo status:
  "@lumba corpu git status"
```

---

## 🛠️ Supported Mention Formats

* **AI Prompts**:
  * `@lumba corpu please fix the bug`
  * `@Lumba (corpu) add unit test for checkout`
  * `@lumba [corpu] update packages`
  * Reply to a stack trace: `@lumba corpu fix this`

* **Dedicated Git Commands**:
  * `@lumba corpu git pull`
  * `@lumba corpu git push [commit message]`
  * `@lumba corpu git status`
  * Bracket syntax is also supported: `@lumba (corpu) git pull`, `@lumba (corpu) git push`

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
| `AUTO_PULL` | Run `git pull` before opencode (optional) | `false` |
| `AUTO_PUSH` | Auto-commit and run `git push` after opencode (optional) | `false` |
| `ALLOWED_NUMBERS` | Optional whitelist (comma-separated phone numbers) | Empty (allows group members) |
