package es.yuanyo.calamartv;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** The starting eleven on the pitch, as pitchRows() in web/match-center.js. */
final class Pitch {
  private Pitch() {}
  interface Spot { String position(); String place(); }

  /** Where a position plays, from the goal outwards (ESPN's abbreviations: G, RB, CD-L, DM, LM, AM-R, CF-L, F…). */
  static double depth(String abbr) {
    String a = abbr == null ? "" : abbr.toUpperCase(Locale.ROOT);
    if (a.equals("G") || a.equals("GK")) return 0;
    if (a.matches("(RB|LB|CB|CD|SW|RWB|LWB|D)(-.*)?")) return 1;
    if (a.startsWith("DM")) return 2;
    if (a.matches("(AM|RW|LW|W)(-.*)?")) return 4;
    // A centre forward goes ahead of the forwards beside him (3-4-2-1: two behind, one in front).
    if (a.matches("F|CF|ST|S")) return 5.5;
    if (a.matches("(F|CF|ST|LF|RF)(-.*)?")) return 5;
    return 3;
  }

  /** From the team's right touchline (0) through right of centre (1), centre (2), left of centre (3) to its left touchline (4). */
  static int flank(String abbr) {
    String a = abbr == null ? "" : abbr.toUpperCase(Locale.ROOT);
    if (a.matches("R(B|M|W|WB|F)")) return 0;
    if (a.endsWith("-R")) return 1;
    if (a.endsWith("-L")) return 3;
    if (a.matches("L(B|M|W|WB|F)")) return 4;
    return 2;
  }

  static double place(Spot p) {
    try { return Double.parseDouble(p.place()); } catch (Exception none) { return 99; }
  }

  /** Rows from the goalkeeper outwards, each from the team's right to its left; the formation gives the sizes. */
  static <T extends Spot> List<List<T>> rows(String formation, List<T> starters) {
    List<T> keeper = new ArrayList<>(), outfield = new ArrayList<>();
    for (T p : starters) (keeper.isEmpty() && depth(p.position()) == 0 ? keeper : outfield).add(p);
    Collections.sort(outfield, Comparator.<T>comparingDouble(p -> depth(p.position())).thenComparingDouble(Pitch::place));
    List<Integer> counts = new ArrayList<>();
    int sum = 0;
    for (String n : (formation == null ? "" : formation).split("-")) {
      try { int v = Integer.parseInt(n.trim()); if (v > 0) { counts.add(v); sum += v; } } catch (NumberFormatException ignored) {}
    }
    List<List<T>> rows = new ArrayList<>();
    if (sum == outfield.size() && sum > 0) {
      int at = 0;
      for (int n : counts) { rows.add(new ArrayList<>(outfield.subList(at, at + n))); at += n; }
    } else {
      // Without a formation that adds up: one row per kind of position.
      for (T p : outfield) {
        List<T> last = rows.isEmpty() ? null : rows.get(rows.size() - 1);
        if (last != null && depth(last.get(0).position()) == depth(p.position())) last.add(p);
        else { List<T> row = new ArrayList<>(); row.add(p); rows.add(row); }
      }
    }
    for (List<T> row : rows) Collections.sort(row, Comparator.<T>comparingInt(p -> flank(p.position())).thenComparingDouble(Pitch::place));
    if (!keeper.isEmpty()) rows.add(0, keeper);
    return rows;
  }
}
