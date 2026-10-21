package es.yuanyo.calamartv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Outline;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.StateListDrawable;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.view.ViewOutlineProvider;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.TextView;

/** Colours, shapes and small views shared by the screens, in the style of the web (web/styles.css). */
final class Ui {
  private Ui() {}

  static final int BG = 0xff0b0d10,
      SURFACE = 0xff1b2027,
      FG = 0xfff5f5f5,
      ACC = 0xffd6ff00,
      MUTED = 0xffaab2bd,
      FAINT = 0xff8a93a0,
      LIVE = 0xffff3b3b;

  static int dp(Context c, float n) {
    return Math.round(c.getResources().getDisplayMetrics().density * n);
  }

  static GradientDrawable shape(Context c, int color, float radiusDp, float strokeDp, int stroke) {
    GradientDrawable g = new GradientDrawable();
    g.setColor(color);
    g.setCornerRadius(dp(c, radiusDp));
    if (strokeDp > 0) g.setStroke(Math.max(1, dp(c, strokeDp)), stroke);
    return g;
  }

  /** A fill that gets a bright outline when focused with a remote or pressed. */
  static StateListDrawable focusFill(
      Context c, int normal, int focused, int outline, float radiusDp, int idleStroke) {
    StateListDrawable s = new StateListDrawable();
    GradientDrawable on = shape(c, focused, radiusDp, 2, outline);
    s.addState(new int[] {android.R.attr.state_focused}, on);
    s.addState(new int[] {android.R.attr.state_pressed}, on);
    s.addState(new int[] {}, shape(c, normal, radiusDp, idleStroke == 0 ? 0 : 1, idleStroke));
    return s;
  }

  enum Kind {
    ACCENT,
    SURFACE,
    GHOST
  }

  static Button pill(Context c, String text, Kind kind, boolean compact) {
    Button b = new Button(c);
    b.setText(text);
    b.setAllCaps(false);
    b.setTextSize(compact ? 13 : 15);
    b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    b.setTextColor(kind == Kind.ACCENT ? BG : FG);
    b.setMinHeight(0);
    b.setMinimumHeight(0);
    b.setMinWidth(0);
    b.setMinimumWidth(0);
    b.setStateListAnimator(null); // no Material elevation shadow
    b.setPadding(dp(c, compact ? 14 : 22), dp(c, compact ? 6 : 10), dp(c, compact ? 14 : 22), dp(c, compact ? 6 : 10));
    int normal = kind == Kind.ACCENT ? ACC : kind == Kind.SURFACE ? SURFACE : Color.TRANSPARENT;
    int focused = kind == Kind.ACCENT ? 0xffeaff66 : 0xff30352a;
    int outline = kind == Kind.ACCENT ? 0xffffffff : ACC;
    b.setBackground(focusFill(c, normal, focused, outline, 999, kind == Kind.GHOST ? 0xff3a424d : 0));
    return b;
  }

  /** Background of a 16:9 card: a colour taken from the name, with a lime outline when focused. */
  static StateListDrawable artBackground(Context c, int hue, float radiusDp) {
    StateListDrawable s = new StateListDrawable();
    GradientDrawable on = artGradient(c, hue, radiusDp);
    on.setStroke(dp(c, 2), ACC);
    s.addState(new int[] {android.R.attr.state_focused}, on);
    s.addState(new int[] {android.R.attr.state_pressed}, on);
    GradientDrawable idle = artGradient(c, hue, radiusDp);
    idle.setStroke(1, 0x14ffffff);
    s.addState(new int[] {}, idle);
    return s;
  }

  /**
   * Lime focus border drawn above a card's content: an event's cover fills the whole card and would
   * hide the border of its background (channels show it because their logo is smaller).
   */
  static StateListDrawable focusOutline(Context c, float radiusDp) {
    StateListDrawable s = new StateListDrawable();
    GradientDrawable on = new GradientDrawable();
    on.setCornerRadius(dp(c, radiusDp));
    on.setStroke(dp(c, 2), ACC);
    s.addState(new int[] {android.R.attr.state_focused}, on);
    s.addState(new int[] {android.R.attr.state_pressed}, on);
    s.addState(new int[] {}, new GradientDrawable());
    return s;
  }

  /** Card background in the colour of its category (same as the web), lime outline when focused. */
  static StateListDrawable categoryBackground(Context c, int color, float radiusDp) {
    StateListDrawable s = new StateListDrawable();
    GradientDrawable on = categoryGradient(c, color, radiusDp);
    on.setStroke(dp(c, 2), ACC);
    s.addState(new int[] {android.R.attr.state_focused}, on);
    s.addState(new int[] {android.R.attr.state_pressed}, on);
    GradientDrawable idle = categoryGradient(c, color, radiusDp);
    idle.setStroke(1, 0x14ffffff);
    s.addState(new int[] {}, idle);
    return s;
  }

  private static GradientDrawable categoryGradient(Context c, int color, float radiusDp) {
    GradientDrawable g =
        new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[] {color, Palette.darker(color, 0.45f)});
    g.setCornerRadius(dp(c, radiusDp));
    return g;
  }

  private static GradientDrawable artGradient(Context c, int hue, float radiusDp) {
    GradientDrawable g =
        new GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            new int[] {Palette.hsl(hue, 0.30f, 0.17f), Palette.hsl(hue, 0.30f, 0.08f)});
    g.setCornerRadius(dp(c, radiusDp));
    return g;
  }

  static GradientDrawable heroBackground(Context c, int hue) {
    GradientDrawable g =
        new GradientDrawable(
            GradientDrawable.Orientation.LEFT_RIGHT,
            new int[] {Palette.hsl(hue, 0.38f, 0.11f), Palette.hsl(hue, 0.45f, 0.06f)});
    g.setCornerRadius(dp(c, 18));
    return g;
  }

  /** The lime "EN DIRECTO" badge with a red dot. */
  static TextView livePill(Context c, String label, float sp) {
    SpannableStringBuilder s = new SpannableStringBuilder("● " + label);
    s.setSpan(new ForegroundColorSpan(LIVE), 0, 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    TextView v = new TextView(c);
    v.setText(s);
    v.setTextColor(BG);
    v.setTextSize(sp);
    v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    v.setLetterSpacing(0.06f);
    v.setPadding(dp(c, 8), dp(c, 3), dp(c, 8), dp(c, 3));
    v.setBackground(shape(c, ACC, 6, 0, 0));
    return v;
  }

  /** The dark badge for a channel that only has its own website. */
  static TextView tag(Context c, String label, float sp) {
    TextView v = new TextView(c);
    v.setText(label);
    v.setTextColor(FG);
    v.setTextSize(sp);
    v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    v.setLetterSpacing(0.06f);
    v.setPadding(dp(c, 8), dp(c, 3), dp(c, 8), dp(c, 3));
    v.setBackground(shape(c, 0xdd0f1217, 6, 0, 0));
    return v;
  }

  static void scaleOnFocus(View v, final float scale) {
    v.setOnFocusChangeListener(
        new View.OnFocusChangeListener() {
          public void onFocusChange(View w, boolean focused) {
            w.animate().scaleX(focused ? scale : 1f).scaleY(focused ? scale : 1f).setDuration(120).start();
          }
        });
  }

  /** "CALAMAR TV" with the lime TV, as in the web header. */
  static TextView brandText(Context c, float sp) {
    SpannableStringBuilder s = new SpannableStringBuilder("CALAMAR TV");
    s.setSpan(new ForegroundColorSpan(ACC), 8, 10, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    TextView v = new TextView(c);
    v.setText(s);
    v.setTextColor(FG);
    v.setTextSize(sp);
    v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
    v.setLetterSpacing(0.14f);
    return v;
  }

  static ImageView brandMark(Context c, float sizeDp) {
    ImageView v = new ImageView(c);
    LayerDrawable d =
        new LayerDrawable(
            new Drawable[] {shape(c, ACC, sizeDp * 0.28f, 0, 0), icon(Icon.PLAY, BG, dp(c, sizeDp))});
    int pad = dp(c, sizeDp * 0.25f);
    d.setLayerInset(1, pad, pad, pad, pad);
    v.setImageDrawable(d);
    return v;
  }

  enum Icon {
    PLAY,
    BACK
  }

  static Drawable icon(Icon icon, int color, int sizePx) {
    return new IconDrawable(icon, color, sizePx);
  }

  /** Simple vector icons drawn with a Path on a 24 x 24 grid, so the app needs no image files. */
  private static final class IconDrawable extends Drawable {
    private final Icon icon;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final int size;

    IconDrawable(Icon icon, int color, int size) {
      this.icon = icon;
      this.size = size;
      paint.setColor(color);
      if (icon == Icon.PLAY) {
        path.moveTo(8f, 5.5f);
        path.lineTo(8f, 18.5f);
        path.lineTo(19f, 12f);
        path.close();
        paint.setStyle(Paint.Style.FILL);
      } else {
        path.moveTo(15f, 5f);
        path.lineTo(8f, 12f);
        path.lineTo(15f, 19f);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(2.2f);
        paint.setStrokeCap(Paint.Cap.ROUND);
        paint.setStrokeJoin(Paint.Join.ROUND);
      }
    }

    @Override
    public void draw(Canvas canvas) {
      android.graphics.Rect b = getBounds();
      if (b.isEmpty()) return;
      int save = canvas.save();
      canvas.translate(b.left, b.top);
      canvas.scale(b.width() / 24f, b.height() / 24f);
      canvas.drawPath(path, paint);
      canvas.restoreToCount(save);
    }

    @Override
    public void setAlpha(int alpha) {
      paint.setAlpha(alpha);
    }

    @Override
    public void setColorFilter(ColorFilter filter) {
      paint.setColorFilter(filter);
    }

    @Override
    public int getOpacity() {
      return PixelFormat.TRANSLUCENT;
    }

    @Override
    public int getIntrinsicWidth() {
      return size;
    }

    @Override
    public int getIntrinsicHeight() {
      return size;
    }
  }

  /** A channel logo with rounded corners; without a picture it shows the channel's initials. */
  // Shared with platform-themed activities; logos use explicit drawing and no support tinting.
  @android.annotation.SuppressLint("AppCompatCustomView")
  static final class LogoView extends ImageView {
    private final String initials;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

    LogoView(Context c, String name, final float radiusDp) {
      super(c);
      initials = Palette.initials(name);
      paint.setColor(0x47ffffff);
      paint.setTypeface(Typeface.DEFAULT_BOLD);
      paint.setTextAlign(Paint.Align.CENTER);
      setScaleType(ScaleType.FIT_CENTER);
      final int radius = dp(c, radiusDp);
      setOutlineProvider(
          new ViewOutlineProvider() {
            @Override
            public void getOutline(View view, Outline outline) {
              outline.setRoundRect(0, 0, view.getWidth(), view.getHeight(), radius);
            }
          });
      setClipToOutline(true);
    }

    @Override
    protected void onDraw(Canvas canvas) {
      if (getDrawable() == null) {
        paint.setTextSize(Math.min(getWidth(), getHeight()) * 0.45f);
        float y = getHeight() / 2f - (paint.descent() + paint.ascent()) / 2f;
        canvas.drawText(initials, getWidth() / 2f, y, paint);
      } else {
        super.onDraw(canvas);
      }
    }
  }
}
