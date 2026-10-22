package es.yuanyo.calamartv;

import static org.junit.Assert.*;

import java.security.SecureRandom;
import org.junit.Test;

public class DeviceLoginTest {
  @Test public void keyAndCodeAreFourEasyCharacters() {
    for (int i = 0; i < 200; i++) {
      DeviceLogin login = DeviceLogin.create(new SecureRandom());
      assertTrue(login.key.matches("[2-9A-HJ-NP-Z]{4}"));
      assertTrue(login.code.matches("[2-9A-HJ-NP-Z]{4}"));
    }
  }

  @Test public void linksAndDocumentMatchTheWebPage() {
    DeviceLogin login = new DeviceLogin("K7Q2", "AB3D");
    assertEquals("djyuanyo.github.io/Calamar-TV/tv/K7Q2", login.shortLink());
    assertEquals("https://djyuanyo.github.io/Calamar-TV/tv/K7Q2?c=AB3D", login.qrLink());
    assertEquals("calamarDeviceLogins/K7Q2AB3D", login.document());
  }
}
