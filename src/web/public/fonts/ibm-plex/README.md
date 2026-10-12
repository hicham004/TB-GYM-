# IBM Plex fonts

IBM Plex Sans and IBM Plex Sans Arabic, Regular (400) and SemiBold (600). Self-hosted WOFF2 files:
no third-party browser requests or new package dependencies.

Source: https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages

Paths: `plex-sans/fonts/complete/woff2/` and `plex-sans-arabic/fonts/complete/woff2/`.
License: SIL Open Font License 1.1, reproduced in LICENSE.txt.

The two Arabic files are unmodified. The two Latin files are subsets of the complete files, made on
2026-10-12 for the homepage's first paint (UI plan R6.2b): they keep Latin, Latin Extended (A, B and
Additional, so Vietnamese and every accented name), combining marks, punctuation, currency, letterlike
symbols, arrows, mathematical operators, geometric shapes and dingbats, with every OpenType layout
feature (tabular numerals included) and no hinting. Greek and Cyrillic are left to the system font.
That takes each file from about 65 kB to about 25 kB. The OFL reserves the name "Plex" for the
unmodified fonts, so the subsets are named "TB Notebook Sans" inside (name IDs 1, 4, 6 and 16); the
stylesheet's own alias, `Notebook Plex`, is unchanged. To make them again from the complete files:

    python -m fontTools.subset IBMPlexSans-Regular.woff2 --flavor=woff2 --output-file=out.woff2       --unicodes="U+0000-00FF,U+0100-024F,U+0259,U+02BB-02BC,U+02C6-02DC,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+25A0-25FF,U+2600-27BF,U+FB00-FB06,U+FEFF,U+FFFD"       --layout-features='*' --name-IDs='*' --notdef-outline --no-hinting

then rename the name table with fontTools (`fontTools.ttLib.TTFont`, name IDs 1, 4, 6, 16).
(fonttools and brotli from PyPI, installed outside the repository.)
