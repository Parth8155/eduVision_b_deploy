# Font Directory

This directory should contain the monospaced font file for precise PDF overlay generation.

## Required Font File

Place the `Courier_New.ttf` font file in this directory for optimal PDF overlay results.

### How to obtain Courier_New.ttf:

1. **Windows Systems**: Copy from `C:\Windows\Fonts\cour.ttf` and rename to `Courier_New.ttf`
2. **macOS Systems**: Copy from `/System/Library/Fonts/Courier.ttc` (you may need to extract the TTF)
3. **Linux Systems**: Install with `sudo apt-get install ttf-dejavu-core` or similar
4. **Alternative**: Download from Google Fonts or other free font repositories

### Fallback Behavior

If `Courier_New.ttf` is not found, the OCR service will automatically fall back to the built-in PDFKit "Courier" font, which should still provide good monospaced spacing for most use cases.

### Font Requirements

- Must be a monospaced (fixed-width) font
- TTF format preferred
- Used for precise character spacing in PDF overlays
