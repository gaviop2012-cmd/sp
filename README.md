# SpotDL Studio 1.1.0

A macOS-first Electron app for processing supported media links, choosing an output directory, and running SpotDL locally without opening a Terminal window during setup or archiving.

## What's included

- A mandatory first-launch Terms of Service and Disclaimer gate. The checkbox must be selected before Continue becomes enabled, and acceptance is recorded locally with a timestamp and agreement version.
- A Spotify-link input for track, album, playlist, artist, and supported short links; neutral interface language such as **Process link** and **Archive task**.
- A destination folder picker whose selected path is remembered between launches.
- MP3, M4A, Opus, OGG, FLAC, and WAV output options.
- A private Python virtual environment for SpotDL and app-managed dependencies.
- Automatic release checks on launch against the official GitHub repositories for SpotDL and yt-dlp. If a newer stable upstream release is found, the app attempts to install that exact version into the private environment, verifies SpotDL starts, and attempts to restore the previous versions if the update command fails. Network/update failures are reported in the Activity panel and should not by themselves block using a working local setup.
- An About / Open-source licenses screen with the full SpotDL MIT, yt-dlp Unlicense, FFmpeg LGPL-2.1 and GPL-2 license texts and upstream links.
- Direct outbound connections from the Mac; no developer-operated proxy or media-download server is implemented.
- Electron context isolation, disabled Node integration in the renderer, an `app.asar` packaged archive, and build-time obfuscation of the original application JavaScript to deter casual copying.

## Important limits

- A local agreement screen records user acceptance but is not a guarantee of an enforceable contract in every jurisdiction and does not replace legal advice.
- FFmpeg's applicable licensing obligations depend on the exact binary and its configuration. The app downloads FFmpeg via SpotDL's helper at runtime; verify the actual build before redistribution.
- The upstream yt-dlp Python package (source/wheel) is under the Unlicense, but some bundled executables include additional third-party components with different licenses. The app uses SpotDL's Python environment rather than redistributing the upstream PyInstaller executable.
- Automatic dependency updates provide ordinary upstream compatibility maintenance; they do not add custom techniques to bypass DRM, access controls, or a provider's restrictions. A UI-code or Electron-app update still requires a new SpotDL Studio release.
- JavaScript obfuscation and `app.asar` deter casual inspection but are not strong DRM and cannot prevent a determined user from extracting or reverse-engineering an Electron app.
- SpotDL reads Spotify metadata and searches supported online sources for matching audio; it does not download the audio stream directly from Spotify. Check the matched media before relying on it, and only archive content you own or are authorized to access.

## Requirements

- macOS (Apple Silicon or Intel).
- Node.js LTS for running or building from source.
- A compatible Python 3.10–3.14 installation. If one is not found, the app displays an in-app prompt and offers the official Python downloads page. The app does not silently install a system-wide Python.
- Internet access for initial dependency setup, update checks, metadata lookup, and supported media providers.

## Run from source

1. Install Node.js LTS and a compatible Python version.
2. Extract this ZIP and open the `spotdl-studio` folder in Terminal.
3. Run:

   ```bash
   npm install
   npm start
   ```

4. On first launch, review the agreement and check the exact consent checkbox. The local SpotDL setup only begins after acceptance.

## Build a macOS package

On your Mac, from the project directory:

```bash
npm install
npm run pack:mac
```

This creates a `.dmg` and `.zip` under `release/`. The release script obfuscates the three app JavaScript files while packaging and restores the readable source files afterwards. The source code in this ZIP remains readable for the owner to modify.

## Build the Windows installer

On a Windows machine, from the project directory:

```powershell
npm install
npm run pack:win
```

This produces a Windows x64 NSIS `.exe` installer under `release/`. Windows should build this installer on a Windows runner rather than trying to cross-build the NSIS installer from macOS.

## Get both installers as direct downloads

The included `.github/workflows/build-release.yml` builds the macOS Apple Silicon `.dmg` and Windows x64 `.exe` on their native GitHub Actions runners, then publishes them as downloadable assets in a GitHub Release. To use it, upload the contents of this project folder to a GitHub repository, open **Actions → Build SpotDL Studio installers → Run workflow**, and let both platform builds finish. The workflow then creates a release named `Build N`; open the repository's **Releases** page to download the `.dmg` and `.exe`. Pushing a version tag such as `v1.1.0` also triggers a release build.

The workflow uses GitHub-hosted build machines; no media or Spotify links are sent to a SpotDL Studio server by this build setup. These install packages have not yet been signed or notarized, so macOS may show a Gatekeeper warning and Windows may display SmartScreen warnings.

## License information

Original SpotDL Studio code is marked `UNLICENSED` in package metadata and has an application-code notice in `LICENSE-PROPRIETARY.txt`. Third-party components retain their own license terms. See `licenses/README.md` and the app's About / Open-source licenses screen before redistributing anything.
