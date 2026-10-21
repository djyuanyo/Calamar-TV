package es.yuanyo.calamartv;

/** Multi-screen layout, as multiGrid() in web/multi-view.js: 2 top and bottom, more in a grid. */
final class MultiScreen {
  static final int MAX = 6;

  private MultiScreen() {}

  /** {rows, columns} for n videos: 2 -> 2x1, 3-4 -> 2x2, 5-6 -> 2x3. */
  static int[] grid(int n) {
    if (n <= 1) return new int[] {1, 1};
    if (n == 2) return new int[] {2, 1};
    int cols = (int) Math.ceil(Math.sqrt(n));
    return new int[] {(int) Math.ceil(n / (double) cols), cols};
  }

  /** Three or more videos are shown on a horizontal screen. */
  static boolean landscape(int n) {
    return n > 2;
  }
}
