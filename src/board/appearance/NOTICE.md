# Piece asset provenance

The SVG path data in `glyphs.ts` is generated from font outlines by
`tools/generate-piece-paths.py`. Font binaries are not shipped.

## Chess

- Source: DejaVu Sans 2.37, `DejaVuSans.ttf`.
- SHA256: `7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954`.
- Glyphs: U+265A–U+265F.
- License: Bitstream Vera / DejaVu derivative; full text in
  `licenses/DejaVu-LICENSE.txt`.

## Xiangqi

- Source: Noto Serif SC variable font, `NotoSerifSC-VF.ttf`.
- SHA256: `a4aed9985a5916fbf6690456f8732a9fccd517938e353165d4142b4f11a39280`.
- Glyphs: `帥 將 仕 士 相 象 馬 車 炮 兵 卒`.
- License: SIL Open Font License 1.1; full text in
  `licenses/OFL-NotoSerifSC.txt`.
- Attribution: Noto is a trademark of Google LLC; Noto Serif SC is
  distributed under the SIL OFL 1.1.

## Generated data

`glyphs.ts` normalizes each glyph to a 100×100 viewBox with 2-decimal path
coordinates. Regenerate only after changing the source font or the
normalization in `tools/generate-piece-paths.py`.
