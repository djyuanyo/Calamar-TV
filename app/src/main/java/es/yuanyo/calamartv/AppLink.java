package es.yuanyo.calamartv;

import java.net.URI;
import java.net.URLDecoder;
import java.util.Arrays;

/** Parses only our public pages. A shared URL can never supply a player URL or admin action. */
final class AppLink {
  final String page, slug;
  private AppLink(String page, String slug) { this.page = page; this.slug = slug; }
  static AppLink parse(String value) {
    try {
      URI uri = new URI(value);
      if (uri.getRawUserInfo() != null || uri.getPort() != -1) return null;
      String route;
      if ("https".equalsIgnoreCase(uri.getScheme()) && "djyuanyo.github.io".equalsIgnoreCase(uri.getHost())) {
        if (!"/Calamar-TV".equals(uri.getRawPath()) && !uri.getRawPath().startsWith("/Calamar-TV/")) return null;
        route = uri.getRawFragment() != null ? uri.getRawFragment() : uri.getRawPath().substring("/Calamar-TV".length());
      } else if ("calamartv".equalsIgnoreCase(uri.getScheme()) && "open".equalsIgnoreCase(uri.getHost())) route = uri.getRawPath();
      else return null;
      if (route == null) return null;
      route = route.replaceAll("^/+|/+$", "");
      if (route.isEmpty()) return new AppLink("inicio", "");
      String[] parts = route.split("/", -1);
      String page = parts[0];
      if (Arrays.asList("liga", "evento", "canal").contains(page) && parts.length == 2) {
        String slug = URLDecoder.decode(parts[1].replace("+", "%2B"), "UTF-8");
        if (slug.isEmpty() || slug.length() > 200 || !slug.matches("[\\p{L}\\p{N}_+ .-]+") || slug.equals(".") || slug.equals("..")) return null;
        return new AppLink(page, slug);
      }
      if (parts.length == 1 && Arrays.asList("inicio", "directo", "canales", "peliculas", "series", "documentales").contains(page)) return new AppLink(page, "");
    } catch (Exception ignored) {}
    return null;
  }
}
