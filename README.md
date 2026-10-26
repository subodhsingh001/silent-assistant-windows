# Desk Notes for Windows

An Electron desktop overlay for transcribing system audio into English, suggesting answers, and generating meeting notes using Google Gemini. Source code is in `silent-assistant/`.

## Requirements on another machine

- Windows 10 or 11. System audio capture is implemented for Windows only.
- [Node.js 24 LTS](https://nodejs.org/en/download), including npm, to run or build from source. Local checks used Node.js 24.21.0.
- [Git](https://git-scm.com/downloads/win) to clone the repository, or download and extract its ZIP from GitHub.
- Internet access and a Gemini API key with access and available quota for the configured models. Follow [Google's API key instructions](https://ai.google.dev/gemini-api/docs/api-key).
- A working speaker/headphone output. Microphone access is needed only when selecting an input mode that includes the microphone.

Electron and JavaScript dependencies install through npm. Python, FFmpeg, and a separate backend server are not required.

## Run from source

After this repository has been uploaded as `subodhsingh001/silent-assistant-windows`, open PowerShell and run:

```powershell
git clone https://github.com/subodhsingh001/silent-assistant-windows.git
cd silent-assistant-windows\silent-assistant
npm.cmd ci
Copy-Item .env.example .env
notepad .env
```

Replace `your_google_ai_studio_api_key` with your own key, save the file, then run:

```powershell
npm.cmd start
```

Use `npm.cmd` in PowerShell to avoid execution-policy errors from `npm.ps1`. If you downloaded a ZIP, open PowerShell in the extracted `silent-assistant` subfolder and start with `npm.cmd ci`.

The template contains these settings:

```dotenv
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODEL=gemini-3.5-flash
```

The model names above are the project's configured defaults. Verify that your Gemini account can use them; change the two model settings if necessary. Restart the app after editing `.env`. An existing `GEMINI_API_KEY` environment variable takes precedence over the `.env` value.

Choose the audio input and press **Start**. The default captures sounds playing on the computer, including remote meeting participants, with your microphone off. Other computer sounds can also be captured. `Ctrl+Shift+Space` toggles the compact overlay. Audio and transcript content are sent to Gemini for processing. Failed audio chunks are kept in memory for retry and are lost when the app quits.

## Build an installer

From the `silent-assistant` directory on Windows:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run dist
```

The Windows NSIS installer is generated in `silent-assistant/dist/desk-notes/`. Build output is excluded from Git; distribute installers separately, for example through GitHub Releases. `npm.cmd run pack` creates an unpacked app for local inspection instead of an installer. The separate output folder lets an older Silent Assistant build remain running while the new build is prepared.

The packaged Windows executable is `Desk Notes.exe`, with the product name **Desk Notes**. Launch the packaged executable or installed app to use this name in Task Manager; `npm.cmd start` still launches the Electron development executable. The running app remains visible in process monitors, and Electron may run several child processes. This naming does not disguise the app as a Windows service or guarantee exclusion from screen capture.

After building, double-click `Start Silent Assistant.cmd` in the repository root (the existing launcher name is retained), or open `silent-assistant\dist\desk-notes\win-unpacked` in File Explorer and double-click `Desk Notes.exe`. The launcher clears `ELECTRON_RUN_AS_NODE` for the child app, since development tools can set that environment variable and cause Electron to start without a window. A file link in chat may only select or open the file location rather than execute it.

## Window visibility and shortcuts

- Click **Background**, or press `Ctrl+Shift+H` on Windows (`Cmd+Shift+H` on macOS), to hide the window while the app keeps running. Press the same shortcut to restore it. Any capture you already started continues; hiding does not start a recording. Stop recording before hiding if you do not want it to continue. The Background button refuses to hide the app if this shortcut could not register.
- A hidden window does not force a particular Task Manager category. Windows decides whether an app appears under Apps or Background processes; macOS Activity Monitor still lists running processes. Process visibility and classification are not controlled by the app.
- Windows: the overlay uses Electron's `skipTaskbar` option to omit its taskbar entry. Verify Alt+Tab behavior on the target Windows version; the app makes no promise about every app-switching or monitoring tool.
- macOS: the code hides the Dock icon using `app.dock.hide()` when its global shortcut registers successfully. This change has only been tested with mocks on Windows; no macOS package or native verification is included. System audio capture remains Windows-only.
- `Ctrl+Shift+Space` on Windows (`Cmd+Shift+Space` on macOS) is registered with the operating system through Electron's `globalShortcut`; it toggles compact/expanded views without requiring app focus. This does not guarantee invisibility to browser code, keyboard hooks, accessibility tools, or monitoring software.
- If the shortcut is already in use, the taskbar/Dock entry stays available for recovery. The overlay's Compact and Quit controls remain available.

References: [Electron global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut), [Dock visibility](https://www.electronjs.org/docs/latest/api/dock#dockhide).

A machine using the built installer does **not** need Node.js, npm, or Git. It still needs Windows, internet, audio output, and its own Gemini key configuration. The packaged app reads `.env` from Electron's per-user app data directory, rather than the source folder. The existing directory is explicitly preserved across the rename: `%APPDATA%\Silent Assistant\.env`:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\Silent Assistant" | Out-Null
notepad "$env:APPDATA\Silent Assistant\.env"
```

Paste the template settings, enter your own key, save, and restart the installed app. The missing-key error also reports the exact path being used. Credentials are not included in the installer.

## Upload to GitHub

The intended owner is `subodhsingh001`; the suggested repository name is `silent-assistant-windows`.

Using [GitHub CLI](https://cli.github.com/), from the top-level project directory:

```powershell
gh auth login
gh auth status
```

Confirm the signed-in account is `subodhsingh001`. If there is no local commit yet, create it:

```powershell
git add .gitignore README.md silent-assistant
git commit -m "Prepare Windows assistant for GitHub"
```

Create a private repository and push the current branch:

```powershell
gh repo create subodhsingh001/silent-assistant-windows --private --source . --remote origin --push
```

Alternatively, create an empty repository named `silent-assistant-windows` on GitHub while signed in as `subodhsingh001`. Leave the initialization options for README, license, and .gitignore unchecked, then run from the top-level project directory after making the local commit:

```powershell
git remote add origin https://github.com/subodhsingh001/silent-assistant-windows.git
git push -u origin HEAD
```

If `origin` already exists, inspect `git remote -v` before changing it. A repository that already contains commits may require merging its history before pushing.

## Files excluded from Git

The root `.gitignore` excludes local `.env` files, `node_modules/`, `dist/`, inspection artifacts, logs, and temporary audio. Keep `.env.example` and `package-lock.json` in the repository so another machine can configure credentials and install the locked dependencies.

## Checks and troubleshooting

Run `npm.cmd test` from `silent-assistant/`. Automated tests use mocks and do not establish live Gemini access or audio capture on another machine.

- **Missing key:** check the `.env` location and restart the app.
- **No audio:** check the selected input, the Windows output device, and the level meter; the default does not capture your own microphone.
- **Model unavailable or access denied:** check the key's permissions and configured model names in Google AI Studio.
- **Rate limits or service busy:** wait and use the app's retry option; the app already retries selected temporary failures and alternates the configured models.
- **Shortcut unavailable:** another app may own `Ctrl+Shift+Space`; use the visible window controls.
