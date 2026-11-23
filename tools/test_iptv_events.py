"""Exercise both IPTV formats using a local catalog and the PHP renderer."""
import json
import pathlib
import shutil
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = r'''
define('CALAMAR_IPTV_LIBRARY', true);
require 'hosting/calamar-iptv.php';
$input = json_decode(stream_get_contents(STDIN), true);
$folders = array();
$channels = iptvChannels($folders, $input['catalog'], $input['tdt']);
$events = iptvLiveEvents($input['catalog'], $channels, strtotime($input['now']));
iptvAddLiveFolder($folders, $events, $input['covers']);
iptvLibrary($folders, function ($path) use ($input) { return $input['library'][$path] ?? null; });
if (!empty($input['xtream'])) {
    $catalog = iptvXcCatalog($folders);
    $series = iptvXcRows($catalog, 'series');
    $first = $series ? iptvXcSeriesInfo($catalog, $series[0]['series_id']) : null;
    echo json_encode([iptvXcRows($catalog, 'live'), iptvXcRows($catalog, 'movie'), $series, $first]);
} else {
    echo json_encode(array(iptvWisePlay(iptvChannelsFolder($folders, ''), ''), iptvM3u($folders)));
}
'''


@unittest.skipUnless(shutil.which('php'), 'PHP CLI is required')
class IptvEventsTest(unittest.TestCase):
    def render(self, catalog, tdt=None, covers=None, library=None, xtream=False):
        result = subprocess.run(['php', '-r', PHP], cwd=ROOT, check=True, capture_output=True, text=True,
                                input=json.dumps({'catalog': catalog, 'tdt': tdt or {}, 'covers': covers or {},
                                                  'now': '2026-11-21T23:30:00Z', 'library': library or {},
                                                  'xtream': xtream}))
        self.assertEqual(result.stderr, '')
        return json.loads(result.stdout)

    def test_channels_sources_and_covers_in_both_formats(self):
        mplus = 'https://media.example/movistar.m3u8'
        tdt_url = 'https://media.example/tdt.m3u8'
        direct = 'https://media.example/manual.m3u8'
        cover = 'https://img.example/event.jpg'
        preview = 'https://img.example/preview.jpg'
        automatic = 'https://media.example/legacy.m3u8'
        iframe = 'https://zicotv.gcorecdn.com/events/52076'
        default = {'startAt': '2026-11-22T10:00:00Z', 'channelId': 'mplus'}
        catalog = {
            'channels': [{'id': 'mplus', 'name': 'M+ LaLiga', 'group': 'Eventos En Directo',
                          'streams': [iframe, mplus]},
                         {'id': 'tdt', 'tdt': True, 'streams': ['https://media.example/old.m3u8']}],
            'teams': [{'id': 'h', 'name': 'Local FC', 'logo': 'https://img.example/h.png'},
                      {'id': 'a', 'name': 'Visitante FC'}],
            'events': [
                {**default, 'id': 'local', 'name': 'Partido del día', 'cover': cover, 'streams': [direct]},
                {**default, 'id': 'finished', 'name': 'Finalizado', 'status': 'finished'},
                {**default, 'id': 'tomorrow', 'name': 'Mañana', 'startAt': '2026-11-23T10:00:00Z'},
                {**default, 'id': 'zico-event-1', 'name': 'Manual', 'channelId': '', 'streams': [automatic, iframe, direct],
                 'zicoStreams': [automatic]},
                {**default, 'id': 'zico-event-2', 'name': 'Sin emisión IPTV', 'channelId': '', 'streams': [iframe]},
                {**default, 'id': 'zico-event-3', 'name': 'Pendiente', 'channelId': ''},
                {**default, 'id': 'expired', 'name': 'Anterior', 'startAt': '2026-11-21T18:00:00Z'},
            ],
            'fixtures': [{'id': 'match', 'homeTeamId': 'h', 'awayTeamId': 'a', 'channelId': 'tdt',
                          'startAt': '2026-11-21T22:30:00Z'}],
        }
        tdt = {'channels': [{'id': 'tdt', 'name': 'La 1', 'group': 'Generalistas', 'streams': [tdt_url]}]}
        wiseplay, m3u = self.render(catalog, tdt, {'match': preview, 'local': 'https://img.example/previous.jpg'})
        channels, events = wiseplay['groups']
        self.assertEqual(channels['name'], 'Canales')
        self.assertEqual(channels['groups'][0]['name'], 'Eventos En Directo')
        self.assertEqual(events['name'], 'Eventos En Directo')
        self.assertEqual([(s['name'], s['url'], s.get('image')) for s in events['stations']], [
            ('Local FC vs Visitante FC', tdt_url, preview), ('Manual', direct, None), ('Partido del día', mplus, cover),
        ])
        rows = [(label, url) for label, url in zip(m3u[::2], m3u[1::2]) if 'group-title="Eventos En Directo"' in label]
        self.assertEqual([url for _, url in rows], [tdt_url, direct, mplus])
        self.assertIn(f'tvg-logo="{preview}"', rows[0][0])
        self.assertIn(f'tvg-logo="{cover}"', rows[2][0])
        self.assertNotIn(automatic, m3u)
        self.assertNotIn(iframe, m3u)

    def test_empty_wiseplay_folder_has_no_fake_m3u_entry(self):
        wiseplay, m3u = self.render({})
        self.assertEqual(wiseplay['groups'], [{'name': 'Eventos En Directo', 'stations': []}])
        self.assertEqual(m3u, [])


    def test_m3u_classifies_channels_movies_and_episodes(self):
        base = 'https://media.example/'
        channels = {'channels': [
            {'id': 'lineal', 'name': 'Canal Hollywood', 'group': 'Series', 'streams': [base + 'live.m3u8']},
        ]}
        library = {
            'calamarLibrary/index': {'sections': {'movies': 1, 'series': 1, 'documentaries': 1}},
            'calamarLibrary/movies-0': {'items': [{'title': 'Una película', 'url': base + 'movie.m3u8'}]},
            'calamarLibrary/series-0': {'items': [{'id': 'serie42', 'title': 'Una serie', 'episodes': [
                {'season': 2, 'episode': 1, 'url': base + 'episode2.m3u8'},
                {'season': 1, 'episode': 3, 'name': 'Piloto', 'url': base + 'episode1.m3u8'},
                {'season': 2, 'episode': 2, 'aired': '2099-01-01', 'url': base + 'future.m3u8'},
            ]}]},
            'calamarLibrary/documentaries-0': {'items': [
                {'title': 'Un documental', 'url': base + 'documentary.mp4'},
                {'title': 'Otra serie', 'episodes': [{'season': 1, 'episode': 1, 'url': base + 'doc-ep.mp4'}]},
            ]},
        }
        wiseplay, m3u = self.render(channels, library=library)
        rows = dict(zip(m3u[1::2], m3u[::2]))

        live = rows[base + 'live.m3u8']
        self.assertTrue(live.startswith('#EXTINF:-1 '))
        self.assertIn('tvg-type="live"', live)
        self.assertIn('group-title="Cine y ficción TV"', live)
        self.assertEqual(wiseplay['groups'][0]['groups'][0]['name'], 'Series')
        for url, group in [('movie.m3u8', 'Películas'), ('documentary.mp4', 'Documentales')]:
            row = rows[base + url]
            self.assertTrue(row.startswith('#EXTINF:0 '))
            self.assertIn('tvg-type="movie"', row)
            self.assertIn(f'group-title="{group}"', row)

        first, second = rows[base + 'episode1.m3u8'], rows[base + 'episode2.m3u8']
        self.assertIn('tvg-type="serie"', first)
        self.assertIn('serie-title="Una serie"', first)
        self.assertIn('tvg-season="1" tvg-episode="3"', first)
        self.assertTrue(first.endswith(',Una serie S01E03 - Piloto'))
        self.assertTrue(second.endswith(',Una serie S02E01'))
        self.assertEqual(first.split('tvg-serie="')[1].split('"')[0], second.split('tvg-serie="')[1].split('"')[0])
        self.assertIn('tvg-type="serie"', rows[base + 'doc-ep.mp4'])
        self.assertIn('group-title="Documentales"', rows[base + 'doc-ep.mp4'])
        self.assertNotIn(base + 'future.m3u8', rows)

    def test_wiseplay_keeps_linear_series_group_without_vod(self):
        channels = {'channels': [
            {'id': 'lineal', 'name': 'Canal Hollywood', 'group': 'Series',
             'streams': ['https://media.example/hollywood.m3u8']},
        ]}
        wiseplay, _ = self.render(channels)
        self.assertEqual(wiseplay['groups'][0]['groups'][0]['name'], 'Series')

    def test_xtream_exposes_live_movies_and_season_episode_data(self):
        media = 'https://media.example/'
        channels = {'channels': [{'id': 'lineal', 'name': 'Hollywood', 'group': 'Series',
                                  'streams': [media + 'live.m3u8']}]}
        library = {
            'calamarLibrary/index': {'sections': {'series': 1, 'documentaries': 1}},
            'calamarLibrary/series-0': {'items': [{'id': 's', 'title': 'Una serie', 'episodes': [
                {'season': 2, 'episode': 2, 'url': media + 's2e2.mp4'},
                {'season': 2, 'episode': 1, 'name': 'Inicio', 'url': media + 's2e1.m3u8'},
            ]}]},
            'calamarLibrary/documentaries-0': {'items': [{'id': 'd', 'title': 'Un documental',
                                                        'url': media + 'documentary.mp4'}]},
        }
        live, movies, series, info = self.render(channels, library=library, xtream=True)
        self.assertEqual([entry['name'] for entry in live], ['Hollywood'])
        self.assertEqual([entry['name'] for entry in movies], ['Un documental'])
        self.assertEqual([entry['name'] for entry in series], ['Una serie'])
        self.assertEqual(info['seasons'][0]['season_number'], 2)
        self.assertEqual([(ep['episode_num'], ep['container_extension']) for ep in info['episodes']['2']],
                         [(1, 'm3u8'), (2, 'mp4')])
        self.assertEqual(info['episodes']['2'][0]['direct_source'], '')

    def test_iptv_uses_registered_original_and_skips_uncached_relay(self):
        php = r"""
define('CALAMAR_IPTV_LIBRARY', true);
require 'hosting/calamar-iptv.php';
$id = str_repeat('a', 32);
$relay = 'https://video.calamarmenciano.com/iptv-hls/' . $id . '/index.m3u8';
$source = 'http://media.example:8080/user/pass/777';
echo json_encode([iptvDirectChannel($relay), iptvDirectChannel($relay, [$id => $source])]);
"""
        result = subprocess.run(['php', '-r', php], cwd=ROOT, check=True, capture_output=True, text=True)
        self.assertEqual(json.loads(result.stdout), [None, 'http://media.example:8080/user/pass/777'])
