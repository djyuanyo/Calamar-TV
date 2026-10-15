import unittest

import sync_tdt

SAMPLE = """# Canales de Televisión

## Nacionales

| Canal | M3U8 | Web | Logo | EPG ID | Info |
| - | - | - | - | - | - |
| La 1 | [m3u8 # 1](https://example.com/la1.m3u8) - [m3u8 # 2](https://ads.example.com/p.m3u8?ip=[IP]) | [web](https://www.rtve.es/la1/) | [logo](https://example.com/la1.png) | La1.TV | GEO |
| Cuatro | - | [web](https://www.mitele.es/cuatro/) | [logo](https://example.com/c.png) | Cuatro.TV | EXTA,GEO |

## Autonómicos

### Andalucía

| Canal | M3U8 | Web | Logo | EPG ID | Info |
| - | - | - | - | - | - |
| Canal Sur Andalucía | [m3u8](https://example.com/cs.m3u8) - [youtube](https://youtube.com/x) | [web](https://www.canalsur.es) | - | CanalSur.TV | - |

## Int. Europa

| Canal | M3U8 | Web | Logo | EPG ID | Info |
| - | - | - | - | - | - |
| France 24 | [m3u8](https://example.com/f24.m3u8) | [web](https://france24.com) | - | - | - |
"""


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.channels = {c["name"]: c for c in sync_tdt.parse(SAMPLE)}

    def test_keeps_spanish_sections_only(self):
        self.assertEqual(set(self.channels), {"La 1", "Cuatro", "Canal Sur Andalucía"})

    def test_channel_names_starting_with_canal_are_not_headers(self):
        channel = self.channels["Canal Sur Andalucía"]
        self.assertEqual(channel["group"], "Autonómicos")
        self.assertEqual(channel["region"], "Andalucía")
        self.assertEqual(channel["streams"], ["https://example.com/cs.m3u8"])

    def test_placeholder_links_are_dropped_and_flags_read(self):
        la1 = self.channels["La 1"]
        self.assertEqual(la1["streams"], ["https://example.com/la1.m3u8"])
        self.assertTrue(la1["geo"])
        self.assertEqual(la1["id"], "la-1")

    def test_web_only_channels_keep_their_page(self):
        cuatro = self.channels["Cuatro"]
        self.assertEqual(cuatro["streams"], [])
        self.assertEqual(cuatro["web"], "https://www.mitele.es/cuatro/")


if __name__ == "__main__":
    unittest.main()
