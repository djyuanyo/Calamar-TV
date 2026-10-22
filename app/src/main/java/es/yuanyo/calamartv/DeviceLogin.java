package es.yuanyo.calamartv;

import java.security.SecureRandom;

/**
 * Signing in from a phone, as on Netflix: the app shows a QR, a short link with its key and a 4-character
 * code; on the phone the administrator signs in with Google and confirms the code, which leaves the Google
 * sign-in at calamarDeviceLogins/<key><code> for 5 minutes. As web/device-login.js.
 */
final class DeviceLogin {
  static final String ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // No 0/O or 1/I.
  static final String PATH = "calamarDeviceLogins";
  static final String SITE = "djyuanyo.github.io/Calamar-TV/tv/";
  static final int MINUTES = 5;

  final String key, code;

  DeviceLogin(String key, String code) {
    this.key = key;
    this.code = code;
  }

  static DeviceLogin create(SecureRandom random) {
    return new DeviceLogin(random(random), random(random));
  }

  private static String random(SecureRandom random) {
    StringBuilder s = new StringBuilder();
    for (int i = 0; i < 4; i++) s.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
    return s.toString();
  }

  /** To type in a browser: djyuanyo.github.io/Calamar-TV/tv/K7Q2. */
  String shortLink() {
    return SITE + key;
  }

  /** What the QR opens: the same page with the code already filled in. */
  String qrLink() {
    return "https://" + SITE + key + "?c=" + code;
  }

  String document() {
    return PATH + "/" + key + code;
  }
}
