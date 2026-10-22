# Third-party license notices

The SpotDL Studio application loads these texts in its About / Open Source Licenses page.

- `spotDL-MIT.txt` is reproduced from https://raw.githubusercontent.com/spotDL/spotify-downloader/master/LICENSE
- `yt-dlp-Unlicense.txt` is reproduced from https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE
- `FFmpeg-COPYING.LGPLv2.1.txt` contains the complete standard GNU LGPL version 2.1 text.
- `FFmpeg-COPYING.GPLv2.txt` contains the complete standard GNU GPL version 2 text.

FFmpeg's own license overview says most files are under LGPL v2.1 or later, while optional parts may be under GPL v2 or later. The applicable terms depend on the exact FFmpeg build and enabled components. Consult https://ffmpeg.org/legal.html and https://ffmpeg.org/doxygen/trunk/md_LICENSE.html. The FFmpeg binary is obtained locally through SpotDL's helper at runtime; the app does not bundle an FFmpeg binary in its source ZIP.

The yt-dlp Python package (source/wheel) is Unlicense per its upstream README, while certain bundled upstream executables include additional third-party components and are covered by different notices. See https://github.com/yt-dlp/yt-dlp#licensing and https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt.

These files are supplied as notices, not as a legal opinion about the license obligations of a particular build or distribution. Re-check upstream licensing before redistributing a packaged application.
