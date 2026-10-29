package es.yuanyo.calamartv;

import static org.junit.Assert.*;
import java.util.*;
import org.json.*;
import org.junit.Test;

public class ProfileDataTest {
  @Test public void profilesAreNamedOnceAndLimitedToFive() {
    List<JSONObject> list = new ArrayList<>();
    JSONObject first = ProfileData.newProfile(list, "Yuanyo", "#db61a2", new Random(1));
    assertEquals("main", first.optString("id"));
    list.add(first);
    JSONObject second = ProfileData.newProfile(list, " Tetur ", "no", new Random(2));
    assertTrue(second.optString("id").matches("p[a-z0-9]{1,6}"));
    assertEquals("Tetur", second.optString("name"));
    assertTrue(second.optString("color").startsWith("#"));
    try { ProfileData.newProfile(list, "yuanyo", null, new Random(3)); fail(); } catch (IllegalArgumentException expected) { }
    while (list.size() < ProfileData.MAX_PROFILES) list.add(ProfileData.newProfile(list, "P" + list.size(), null, new Random(list.size())));
    try { ProfileData.newProfile(list, "Otro", null, new Random(9)); fail(); } catch (IllegalArgumentException expected) { }
  }

  @Test public void listLikesFavouritesAndHistoryAsOnTheWeb() {
    JSONObject data = ProfileData.empty();
    data = ProfileData.toggleList(data, "peliculas", "m1", 10);
    assertTrue(ProfileData.inList(data, "peliculas", "m1"));
    assertEquals("peliculas/m1", data.optJSONObject("list").keys().next());
    data = ProfileData.toggleList(data, "peliculas", "m1", 20);
    assertFalse(ProfileData.inList(data, "peliculas", "m1"));
    data = ProfileData.rate(data, "series", "s1", 1, 30);
    assertEquals(1, ProfileData.rating(data, "series", "s1"));
    assertEquals("s1", ProfileData.lastLiked(data).optString("item"));
    data = ProfileData.rate(data, "series", "s1", 1, 40);
    assertEquals(0, ProfileData.rating(data, "series", "s1"));
    data = ProfileData.toggleFavorite(data, "la-1", 50);
    assertEquals(Collections.singletonList("la-1"), ProfileData.favorites(data));
    for (int i = 0; i < ProfileData.WATCHED_LIMIT + 3; i++) data = ProfileData.markWatched(data, "peliculas", "m" + i, 100 + i);
    assertEquals(ProfileData.WATCHED_LIMIT, data.optJSONObject("watched").length());
    assertEquals(100 + ProfileData.WATCHED_LIMIT + 2, data.optLong("updatedAt"));
  }

  @Test public void theNewerCopyWinsAndOlderCopiesAreCompleted() throws JSONException {
    JSONObject old = new JSONObject().put("updatedAt", 5).put("list", new JSONObject());
    JSONObject fresh = new JSONObject().put("updatedAt", 9);
    assertSame(fresh, ProfileData.newer(old, fresh));
    assertSame(old, ProfileData.newer(old, null));
    JSONObject valid = ProfileData.valid(fresh);
    assertNotNull(valid.optJSONObject("watched"));
    assertEquals(9, valid.optLong("updatedAt"));
  }
}
