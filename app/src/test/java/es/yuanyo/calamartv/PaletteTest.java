package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import org.junit.Test;

public class PaletteTest {
  @Test
  public void hueMatchesTheWebForTheSameNames() {
    // Values produced by hue() in web/app.js.
    assertEquals(14, Palette.hue("La 1"));
    assertEquals(249, Palette.hue("Teledeporte"));
    assertEquals(327, Palette.hue("Canal Sur Andalucía"));
    assertEquals(86, Palette.hue("24h"));
    assertEquals(142, Palette.hue("Clan"));
    assertEquals(21, Palette.hue("Movistar LaLiga TV"));
    assertEquals(318, Palette.hue("Ñandú 📺")); // an emoji is one code point, as in JavaScript
    assertEquals(0, Palette.hue(""));
  }

  @Test
  public void hueIsAlwaysAValidAngle() {
    for (String name : new String[] {"a", "zzzzzzzzzzzzzzzzzzzzzzzzzzzz", "Canal ñ 123 — directo"}) {
      int h = Palette.hue(name);
      assertTrue(name + " -> " + h, h >= 0 && h < 360);
    }
  }

  @Test
  public void hslProducesTheExpectedPrimaries() {
    assertEquals(0xffff0000, Palette.hsl(0, 1f, 0.5f));
    assertEquals(0xff00ff00, Palette.hsl(120, 1f, 0.5f));
    assertEquals(0xff0000ff, Palette.hsl(240, 1f, 0.5f));
    assertEquals(0xffffffff, Palette.hsl(75, 0f, 1f));
    assertEquals(0xff000000, Palette.hsl(75, 0.5f, 0f));
    assertEquals(0xff808080, Palette.hsl(200, 0f, 0.5f));
  }

  @Test
  public void hslWrapsAnglesAndStaysOpaque() {
    assertEquals(Palette.hsl(10, 0.4f, 0.2f), Palette.hsl(370, 0.4f, 0.2f));
    assertEquals(Palette.hsl(350, 0.4f, 0.2f), Palette.hsl(-10, 0.4f, 0.2f));
    assertEquals(0xff, Palette.hsl(210, 0.3f, 0.15f) >>> 24);
  }

  @Test
  public void initialsTakeUpToTwoWords() {
    assertEquals("LU", Palette.initials("La Uno Plus"));
    assertEquals("T", Palette.initials("Teledeporte"));
    assertEquals("ÑD", Palette.initials("ñandú dos"));
    assertEquals("", Palette.initials("   "));
  }
}
