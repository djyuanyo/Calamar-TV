package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import org.junit.Test;

public class AppLinkTest {
  @Test public void parsesSharedPagesHashPagesAndTheAppScheme() {
    String base = "https://djyuanyo.github.io/Calamar-TV/";
    for (String route : new String[]{"liga/laliga", "evento/local-vs-visitante", "canal/la-1", "directo", "canales", "peliculas", "peliculas/m12", "series/s34", "documentales/m56"}) {
      for (String url : new String[]{base + route + "/", base + "#/" + route, "calamartv://open/" + route}) {
        AppLink parsed = AppLink.parse(url); assertNotNull(url, parsed);
        assertEquals(route.split("/")[0], parsed.page);
      }
    }
    assertEquals("inicio", AppLink.parse(base).page);
  }
  @Test public void rejectsOtherDomainsProjectsCredentialsAndUnsafeRoutes() {
    for (String url : new String[]{"https://evil.test/Calamar-TV/liga/a", "https://djyuanyo.github.io/CDMenciana/", "https://djyuanyo.github.io/Calamar-TV-evil/liga/a",
        "https://user@djyuanyo.github.io/Calamar-TV/liga/a", "https://djyuanyo.github.io:999/Calamar-TV/liga/a", "https://djyuanyo.github.io/Calamar-TV/#/admin",
        "calamartv://open/evento/https%3A%2F%2Fevil.test", "calamartv://open/liga/%2e%2e", "calamartv://open/liga/a/extra"}) assertNull(url, AppLink.parse(url));
  }
}
