package es.yuanyo.calamartv;

import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;
import java.lang.ref.WeakReference;
import java.util.*;
import java.util.concurrent.*;

/** Bounded, dialog-owned artwork loading; reuses the app's disk cache and mirrored crests. */
final class EventCardImages {
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ThreadPoolExecutor worker = new ThreadPoolExecutor(3, 3, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(48));
  private final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>(8 * 1024 * 1024) {
    @Override protected int sizeOf(String key, Bitmap bitmap) { return bitmap.getByteCount(); }
  };
  private final Map<String, List<WeakReference<ImageView>>> pending = new HashMap<>();
  private boolean closed;
  void load(ImageView view, String url, boolean crest) {
    if (url == null || !(url.startsWith("https://") || url.startsWith("data:image/"))) return;
    view.setTag(url); Bitmap found = cache.get(url); if (found != null) { view.setImageBitmap(found); return; }
    List<WeakReference<ImageView>> waiting = pending.get(url);
    if (waiting != null) { waiting.add(new WeakReference<>(view)); return; }
    waiting = new ArrayList<>(); waiting.add(new WeakReference<>(view)); pending.put(url, waiting);
    try { worker.execute(() -> {
      Bitmap bitmap = null;
      try {
        if (url.startsWith("data:image/")) bitmap = MainActivity.decodeBitmap(android.util.Base64.decode(url.substring(url.indexOf(',') + 1), android.util.Base64.DEFAULT));
        else { String copy = crest ? Catalog.mirror(url) : null; if (copy != null) bitmap = MainActivity.readBitmap(copy); if (bitmap == null && !Thread.currentThread().isInterrupted()) bitmap = MainActivity.readBitmap(url); }
      } catch (Exception ignored) { }
      final Bitmap ready = bitmap;
      main.post(() -> {
        if (closed) return;
        List<WeakReference<ImageView>> views = pending.remove(url);
        if (ready != null) { cache.put(url, ready); if (views != null) for (WeakReference<ImageView> ref : views) { ImageView image = ref.get(); if (image != null && url.equals(image.getTag())) image.setImageBitmap(ready); } }
      });
    }); } catch (RejectedExecutionException full) { pending.remove(url); }
  }
  void close() { closed = true; worker.shutdownNow(); pending.clear(); cache.evictAll(); main.removeCallbacksAndMessages(null); }
}
