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
echo json_encode(array(iptvWisePlay(iptvChannelsFolder($folders, ''), ''), iptvM3u($folders)));
'''


@unittest.skipUnless(shutil.which('php'), 'PHP CLI is required')
class IptvEventsTest(unittest.TestCase):
    def render(self, catalog, tdt=None, covers=None):
        result = subprocess.run(['php', '-r', PHP], cwd=ROOT, check=True, capture_output=True, text=True,
                                input=json.dumps({'catalog': catalog, 'tdt': tdt or {}, 'covers': covers or {},
                                                  'now': '2026-11-21T23:30:00Z'}))
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
