package es.yuanyo.calamartv;

/**
 * Colours derived from a channel's name. Pure Java, so it is tested without Android. {@link
 * #hue(String)} gives the same value as hue() in web/app.js: a card has the same colour in the app
 * and on the web.
 */
final class Palette {
  private Palette() {}

  /** Stable hue in degrees, 0..359, for a name. */
  static int hue(String name) {
    int h = 0;
    for (int i = 0; i < name.length(); ) {
      int codePoint = name.codePointAt(i);
      h = (h * 31 + codePoint) % 360;
      i += Character.charCount(codePoint);
    }
    return h;
  }

  /** Opaque ARGB colour from hue (degrees), saturation and lightness (both 0..1). */
  static int hsl(float hue, float saturation, float lightness) {
    float h = ((hue % 360f) + 360f) % 360f / 60f;
    float c = (1f - Math.abs(2f * lightness - 1f)) * saturation;
    float x = c * (1f - Math.abs(h % 2f - 1f));
    float r = 0, g = 0, b = 0;
    if (h < 1) {
      r = c;
      g = x;
    } else if (h < 2) {
      r = x;
      g = c;
    } else if (h < 3) {
      g = c;
      b = x;
    } else if (h < 4) {
      g = x;
      b = c;
    } else if (h < 5) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    float m = lightness - c / 2f;
    return 0xff000000 | channel(r + m) << 16 | channel(g + m) << 8 | channel(b + m);
  }

  private static int channel(float value) {
    return Math.max(0, Math.min(255, Math.round(value * 255f)));
  }

  /** ARGB of a #rrggbb colour; grey when the text is not one. */
  static int parse(String hex) {
    if (hex == null || !hex.matches("#[0-9a-fA-F]{6}")) return 0xff3a4250;
    return 0xff000000 | Integer.parseInt(hex.substring(1), 16);
  }

  /** The same colour with each channel scaled by {@code factor} (0..1), for the end of a gradient. */
  static int darker(int argb, float factor) {
    return 0xff000000
        | channel((argb >> 16 & 0xff) / 255f * factor) << 16
        | channel((argb >> 8 & 0xff) / 255f * factor) << 8
        | channel((argb & 0xff) / 255f * factor);
  }

  /** Up to two initials, for a channel without a usable logo. */
  static String initials(String name) {
    StringBuilder out = new StringBuilder();
    for (String word : name.trim().split("\\s+")) {
      if (word.isEmpty()) continue;
      out.appendCodePoint(Character.toUpperCase(word.codePointAt(0)));
      if (out.codePointCount(0, out.length()) == 2) break;
    }
    return out.toString();
  }
}
