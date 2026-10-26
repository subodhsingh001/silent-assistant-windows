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

The Windows NSIS installer is generated in `silent-assistant/dist/desk-notes-1.0.5/`. Build output is excluded from Git; distribute installers separately, for example through GitHub Releases. `npm.cmd run pack` creates an unpacked app for local inspection instead of an installer. The versioned output folder lets an older build remain running while the update is prepared. Quit the old app before opening the updated build, so the copies do not compete for hotkeys or capture audio twice.

The packaged Windows executable is `Desk Notes.exe`, with the product name **Desk Notes**. Launch the packaged executable or installed app to use this name in Task Manager; `npm.cmd start` still launches the Electron development executable. The running app remains visible in process monitors, and Electron may run several child processes. This naming does not disguise the app as a Windows service or guarantee exclusion from screen capture.

After building, double-click `Start Silent Assistant.cmd` in the repository root (the existing launcher name is retained), or open `silent-assistant\dist\desk-notes-1.0.5\win-unpacked` in File Explorer and double-click `Desk Notes.exe`. The heading displays **Desk Notes 1.0.5**, so you can check that you opened the update. The launcher clears `ELECTRON_RUN_AS_NODE` for the child app, since development tools can set that environment variable and cause Electron to start without a window. A file link in chat may only select or open the file location rather than execute it.

## Window visibility and shortcuts

- Click **Background**, or press `Ctrl+Shift+H` on Windows (`Cmd+Shift+H` on macOS), to hide the window while the app keeps running. Press the same shortcut to restore it. Any capture you already started continues; hiding does not start a recording. Stop recording before hiding if you do not want it to continue. The Background button refuses to hide the app if this shortcut could not register.
- A hidden window does not force a particular Task Manager category. Windows decides whether an app appears under Apps or Background processes; macOS Activity Monitor still lists running processes. Process visibility and classification are not controlled by the app.
- Windows: the overlay uses Electron's `skipTaskbar` option to omit its taskbar entry. Verify Alt+Tab behavior on the target Windows version; the app makes no promise about every app-switching or monitoring tool.
- macOS: the code hides the Dock icon using `app.dock.hide()`. This change has only been tested with mocks on Windows; no macOS package or native verification is included. System audio capture remains Windows-only.
- `Ctrl+Shift+Space` on Windows (`Cmd+Shift+Space` on macOS) is registered with the operating system through Electron's `globalShortcut`; it toggles compact/expanded views without requiring app focus. This does not guarantee invisibility to browser code, keyboard hooks, accessibility tools, or monitoring software.
- Shortcut conflicts keep the taskbar/Dock entry hidden. The overlay's Compact and Quit controls remain available; Background mode refuses to hide without its recovery shortcut.

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

The audio worker combines waiting clips into chronological batches of up to four clips and approximately 4 MB of raw recording data. Each WebM remains a separate `inlineData` part; containers are not concatenated. The main process rejects more than four clips or more than 8 MB of base64 data. A failed batch retains every original clip for retry. A secondary text-only answer request runs independently of the audio worker; stale responses and partial text cannot replace a newer detected answer. Splitting all transcription and answering into separate debounced/cancellable streams remains a future architecture change.

Live and typed answer requests include the questions already answered in the current session inside `<already_answered>`. The model is instructed to answer only the latest new question, output exactly `[SKIP]` in its answer field for semantic duplicates (including rewordings or partial repeats), and `[WAIT]` for unfinished new questions. The UI consumes these markers without displaying or saving them as answers. Exact repeats, filler, punctuation, and stutters also receive a local duplicate check. Semantic matching and recognition corrections still depend on the model. Clicking Clear or restarting the app resets this session history. Answers are limited to 4-5 sentences unless code or necessary detail is needed; programming answers retain code examples.

Run `npm.cmd test` from `silent-assistant/`. Automated tests use mocks and do not establish live Gemini access or audio capture on another machine.

Speech segments are submitted after approximately 1,100 ms of silence, once at least 1,800 ms has been captured, with an eight-second maximum during uninterrupted speech. Gemini processing and network time still add latency; capture still uses audio segments rather than a continuously connected Live API. If eight audio segments are waiting or saved for retry, capture pauses rather than silently accumulating a long delay. Capture timestamps show which speech an answer belongs to.

Live audio and text answer requests default to a 20-second timeout per attempt, with one alternate-model retry. The client default is 15 seconds; meeting notes override it to 60 seconds. Set GEMINI_LIVE_TIMEOUT_MS and GEMINI_HTTP_TIMEOUT_MS in the local .env and restart the app to change the defaults. Timeouts must be between 1,000 and 120,000 ms. A short timeout switches away from a slow model sooner but can cancel a request that would otherwise have completed. A 12-second limit passed the short arithmetic test but timed out on the programming example, so the default is 20 seconds. Set GEMINI_LIVE_TIMEOUT_MS=12000 explicitly if you prefer the more aggressive policy. Known supported Flash models, including gemini-3.5-flash-lite, explicitly use thinkingLevel: minimal. Other models retain their provider defaults rather than receiving an unsupported thinking setting. Exhausted audio requests keep their recording for manual retry. Answers stream into the panel as the model generates them. Completed Q&A is timestamped and retained in Answered questions; subsequent filler speech or processing does not erase it. A clearly transcribed question ending in a question mark triggers a text-only answer request if audio analysis omits its question or answer. Programming answers request a short code example in the relevant language. **Answer detected question** only resubmits the detected question; it does not search the full old transcript for something to answer. You can also enter a specific question in the text field.

For unrelated transcripts, use **Client / Teams audio** for remote speech and pause other tabs, music, or videos. That mode captures all playback, not a single application's audio. Compare the visible transcript with the actual speech before relying on the answer. The model is instructed not to invent speech, and answers with no supporting transcript/question are suppressed, but these checks cannot guarantee transcription accuracy. No built-in sample questions are included in the production app; sample answers in tests are mocks only.

- **Missing key:** check the `.env` location and restart the app.
- **No audio:** check the selected input, the Windows output device, and the level meter; the default does not capture your own microphone.
- **Model unavailable or access denied:** check the key's permissions and configured model names in Google AI Studio.
- **Rate limits or service busy:** wait and use the app's retry option; the app already retries selected temporary failures and alternates the configured models.
- **Shortcut unavailable:** another app may own `Ctrl+Shift+Space`; use the visible window controls.
