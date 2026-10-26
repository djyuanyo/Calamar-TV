package es.yuanyo.calamartv;
import static org.junit.Assert.*;
import java.util.*;
import org.junit.Test;

/** The same real ESPN elevens as tools/match_center.test.mjs. */
public class PitchTest {
  static final class P implements Pitch.Spot {
    final String position, place;
    P(String place, String position) { this.place = place; this.position = position; }
    public String position() { return position; } public String place() { return place; }
  }
  static List<P> xi(String text) { List<P> out = new ArrayList<>(); for (String t : text.split(" ")) { String[] x = t.split(":"); out.add(new P(x[0], x[1])); } return out; }
  static List<String> names(List<List<P>> rows) { List<String> out = new ArrayList<>(); for (List<P> r : rows) { StringBuilder b = new StringBuilder(); for (P p : r) b.append(b.length() > 0 ? " " : "").append(p.position); out.add(b.toString()); } return out; }

  @Test public void formationsGoInTheirRowsFromRightToLeft() {
    assertEquals(Arrays.asList("G", "RB CD-R CD-L LB", "RM LM", "AM-R AM AM-L", "F"), names(Pitch.rows("4-2-3-1", xi("1:G 2:RB 3:LB 4:LM 5:CD-R 6:CD-L 7:AM-R 8:RM 9:F 10:AM 11:AM-L"))));
    assertEquals(Arrays.asList("G", "RB CD-R CD CD-L LB", "RM CM-R CM-L LM", "F"), names(Pitch.rows("5-4-1", xi("1:G 2:RB 3:LB 4:CD-L 5:CD 6:CD-R 7:RM 8:CM-R 9:F 10:CM-L 11:LM"))));
    assertEquals(Arrays.asList("G", "CD-R CD CD-L", "RM CM-R CM-L LM", "CF-R F CF-L"), names(Pitch.rows("3-4-3", xi("1:G 2:RM 3:LM 4:CD-L 5:CD 6:CD-R 7:CM-R 8:CM-L 9:F 10:CF-R 11:CF-L"))));
    assertEquals(Arrays.asList("G", "CD-R CD CD-L", "RM CM-R CM-L LM", "CF-R CF-L", "F"), names(Pitch.rows("3-4-2-1", xi("1:G 2:RM 3:LM 4:CD-L 5:CD 6:CD-R 7:CM-R 8:CM-L 9:F 10:CF-R 11:CF-L"))));
    assertEquals(Arrays.asList("G", "RB CD-R CD-L LB", "DM", "CM-R CM-L", "RW LW", "F"), names(Pitch.rows("", xi("1:G 2:RB 3:LB 5:CD-R 6:CD-L 4:DM 8:CM-R 10:CM-L 7:RW 11:LW 9:F"))));
  }
}
