package es.yuanyo.calamartv;

import java.io.IOException;
import java.net.URI;
import java.util.List;

/** Resolves every tile independently. Zico player/event pages only use the owned hosting. */
final class MultiSource {
  static final class Result {
    final String url, page, referer;
    Result(String url, String page, String referer) {
      this.url = url; this.page = page;
      String origin = null;
      if (page != null && referer != null) try {
        URI parsed = URI.create(referer);
        if (parsed.getHost() != null && ("https".equals(parsed.getScheme()) || "http".equals(parsed.getScheme())))
          origin = new URI(parsed.getScheme(), null, parsed.getHost(), parsed.getPort(), "/", null, null).toString();
      } catch (Exception invalid) { /* A media request never needs page credentials or query parameters. */ }
      this.referer = origin;
    }
    boolean hosted() { return HostingPlayback.isRelay(url); }
    boolean renewable() { return page != null && UserChannels.isPage(page); }
    long renewalDelay() { return page == null ? -1 : VideoResolver.pageRenewalDelay(page, url, System.currentTimeMillis()); }
  }
  static Result resolve(String page, String endpoint, String signal, int attempt,
      PlayerDocument.ConnectionFactory hosting, PlayerDocument.ConnectionFactory device) throws Exception {
    return resolve(page, endpoint, signal, attempt, hosting, device, 0);
  }
  private static Result resolve(String page, String endpoint, String signal, int attempt,
      PlayerDocument.ConnectionFactory hosting, PlayerDocument.ConnectionFactory device, int depth) throws Exception {
    if (depth > 2) throw new IOException("Las fuentes del evento no contienen vídeo compatible");
    if (VideoResolver.eventApi(page) != null) {
      PlayerDocument.Result event = HostingPlayback.event(page, endpoint, hosting);
      List<VideoResolver.Source> players = VideoResolver.eventPlayers(event.html);
      if (players.isEmpty()) throw new IOException("El evento todavía no publica fuentes disponibles");
      Exception last = null;
      for (VideoResolver.Source source : players) try {
        return resolve(source.url, HostingPlayback.endpoint(event.url), signal, attempt, hosting, device, depth + 1);
      } catch (Exception failure) { last = failure; }
      throw last;
    }
    if (VideoResolver.renewablePage(page)) {
      String url = HostingPlayback.resolve(page, signal, attempt, endpoint, hosting);
      return new Result(url, page, HostingPlayback.endpoint(url));
    }
    if (!UserChannels.isPage(page)) return new Result(page, null, null);
    if (AppSources.zico(page)) throw new IOException("Esta fuente no ofrece una página de vídeo compatible");
    String relay = Library.Media.hosting(page);
    if (relay != null) return new Result(relay, page, Library.LULU_ENDPOINT);
    PlayerDocument.Result document = PlayerDocument.fetch(page, device);
    List<VideoResolver.Source> sources = VideoResolver.parse(document.html, document.url);
    if (sources.isEmpty()) throw new IOException("No se encontró una fuente de vídeo compatible");
    VideoResolver.Source chosen = sources.get(Math.min(attempt, sources.size() - 1));
    URI origin = URI.create(document.url);
    return new Result(chosen.url, page, origin.getScheme() + "://" + origin.getRawAuthority() + "/");
  }
}
