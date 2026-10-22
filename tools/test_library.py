"""Plex-style library: folder scan, episode numbers, TMDB matching (fake TMDB) and the published JSON."""
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FAKE_TMDB = r'''
$tmdb = function($method, $url, $body = null, $bearer = null) {
    $q = []; parse_str(parse_url($url, PHP_URL_QUERY), $q); $path = parse_url($url, PHP_URL_PATH);
    if (str_ends_with($path, '/search/movie')) return [200, ['results' => $q['query'] === 'Avatar'
        ? [['id' => 19995, 'title' => 'Avatar', 'release_date' => '2009-12-15', 'poster_path' => '/a.jpg', 'overview' => 'Pandora']]
        : [['id' => 1, 'title' => 'Algo totalmente distinto', 'release_date' => '2001-01-01']]]];
    if (str_ends_with($path, '/search/tv')) return [200, ['results' => [['id' => 4500, 'name' => 'Los hombres de Paco', 'first_air_date' => '2005-10-09', 'poster_path' => '/p.jpg']]]];
    if (str_ends_with($path, '/movie/19995')) return [200, ['title' => 'Avatar', 'release_date' => '2009-12-15', 'overview' => 'En Pandora…',
        'genres' => [['name' => 'Ciencia ficción']], 'vote_average' => 7.58, 'vote_count' => 30000, 'runtime' => 162, 'poster_path' => '/a.jpg', 'backdrop_path' => '/b.jpg',
        'credits' => ['cast' => [['name' => 'Sam Worthington', 'character' => 'Jake Sully']]]]];
    if (str_ends_with($path, '/tv/4500')) return [200, ['name' => 'Los hombres de Paco', 'first_air_date' => '2005-10-09', 'overview' => 'Comisaría de San Antonio',
        'genres' => [['name' => 'Comedia']], 'vote_average' => 7.1, 'episode_run_time' => [75], 'credits' => ['cast' => [['name' => 'Paco Tous', 'character' => 'Paco']]],
        'season/10' => ['episodes' => [['episode_number' => 1, 'name' => 'Vuelta a empezar', 'overview' => 'La comisaría reabre']]]]];
    return [404, null];
};
'''


class LibraryTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp())
        files = ['MENCIA MEDIA/PELICULAS/Avatar (2009)/Avatar.mkv', 'MENCIA MEDIA/PELICULAS/Raro.Desconocido.2001.720p.mkv',
                 'MENCIA MEDIA/SERIES/Los Hombres de Paco (Temporada 10)/Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1002][AC3 5.1 Castellano].mkv',
                 'MENCIA MEDIA/SERIES/Los Hombres de Paco (Temporada 10)/Los Hombres De Paco - Temporada 10 [HDTV 720p][Cap.1001][AC3 5.1 Castellano].mkv',
                 'MENCIA MEDIA/SERIES/Los Hombres de Paco (Temporada 10)/leeme.txt', 'MENCIA MEDIA/SERIES/suelto.mkv',
                 'MENCIA MEDIA/DOCUMENTALES/Planeta Tierra II - Capitulo 1.mp4']
        for f in files:
            (self.root / f).parent.mkdir(parents=True, exist_ok=True)
            (self.root / f).write_bytes(b'x')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def php(self, code):
        program = '$_SERVER["SCRIPT_FILENAME"] = "test"; require ' + json.dumps(str(ROOT / 'hosting/calamar-library.php')) + ';' + FAKE_TMDB + code
        return json.loads(subprocess.check_output(['php', '-r', program], text=True))

    def test_scan_matches_and_publishes(self):
        result = self.php('''
            $scan = libraryScan(''' + json.dumps(str(self.root)) + ''', LIBRARY_SECTIONS);
            $state = ['scan' => $scan, 'matches' => [], 'details' => []];
            [$state, $pending] = libraryMatchNext($state, 'k', $tmdb);
            echo json_encode(['pending' => $pending, 'library' => libraryPublish($state['scan'], $state['matches'], $state['details'])]);''')
        self.assertEqual(result['pending'], 0)
        sections = result['library']['sections']
        films = {m['title']: m for m in sections['movies']}
        self.assertEqual(set(films), {'Avatar', 'Raro Desconocido'})
        avatar = films['Avatar']
        self.assertEqual((avatar['year'], avatar['status'], avatar['tmdb']['rating'], avatar['tmdb']['genres']), (2009, 'matched', 7.6, ['Ciencia ficción']))
        self.assertEqual(avatar['tmdb']['cast'][0]['name'], 'Sam Worthington')
        self.assertEqual(avatar['tmdb']['poster'], 'https://image.tmdb.org/t/p/w342/a.jpg')
        self.assertEqual(avatar['url'], 'https://calamarmenciano.com/MENCIA%20MEDIA/PELICULAS/Avatar%20%282009%29/Avatar.mkv')
        # A first result that does not look like the title is not accepted automatically.
        self.assertEqual((films['Raro Desconocido']['status'], 'tmdb' in films['Raro Desconocido']), ('none', False))
        [paco] = sections['series']  # Files loose in the series folder are not a series.
        self.assertEqual((paco['title'], paco['status'], paco['tmdb']['title']), ('Los Hombres de Paco', 'matched', 'Los hombres de Paco'))
        self.assertEqual([(e['season'], e['episode']) for e in paco['episodes']], [(10, 1), (10, 2)])
        self.assertEqual(paco['episodes'][0]['name'], 'Vuelta a empezar')
        self.assertEqual([d['title'] for d in sections['documentaries']], ['Planeta Tierra II'])
        self.assertIn('TMDB', result['library']['attribution'])

    def test_folders_outside_the_site_are_ignored(self):
        result = self.php('echo json_encode(libraryScan(' + json.dumps(str(self.root)) + ', ["movies" => "../../etc", "series" => "MENCIA MEDIA/SERIES"]));')
        self.assertEqual(result['movies'], [])
        self.assertEqual(len(result['series']), 1)

    def test_google_drive_folders(self):
        """Drive sections: folders and subfolders through the Drive API (fake), links that play from Drive."""
        result = self.php(r'''
            $tree = [
              'PELIS' => [['id' => 'dAvatarFolder', 'name' => 'Avatar (2009)', 'mimeType' => 'application/vnd.google-apps.folder'],
                          ['id' => 'fRaro', 'name' => 'Raro.Desconocido.2001.720p.mkv', 'mimeType' => 'video/x-matroska'],
                          ['id' => 'fNota', 'name' => 'leeme.txt', 'mimeType' => 'text/plain']],
              'dAvatarFolder' => [['id' => 'fAvatar', 'name' => 'Avatar.mp4', 'mimeType' => 'video/mp4']],
              'SERIES' => [['id' => 'dPaco', 'name' => 'Los Hombres de Paco', 'mimeType' => 'application/vnd.google-apps.folder']],
              'dPaco' => [['id' => 'dT10', 'name' => 'Temporada 10', 'mimeType' => 'application/vnd.google-apps.folder']],
              'dT10' => [['id' => 'fE2', 'name' => 'Paco 10x02.mkv', 'mimeType' => 'video/x-matroska'], ['id' => 'fE1', 'name' => 'Paco 10x01.mkv', 'mimeType' => 'video/x-matroska']],
            ];
            $asked = [];
            $drive = function($method, $url) use ($tree, &$asked) {
                $q = []; parse_str(parse_url($url, PHP_URL_QUERY), $q);
                preg_match("~^'([^']+)' in parents~", $q['q'], $m); $asked[] = $q['key'];
                return isset($tree[$m[1]]) ? [200, ['files' => $tree[$m[1]]]] : [404, null];
            };
            $folders = ['movies' => 'https://drive.google.com/drive/folders/PELIS?usp=sharing', 'series' => 'SERIES'];
            $scan = libraryScan('/nonexistent', ['movies' => 'https://drive.google.com/drive/folders/PELISPELISPELIS1234567890?usp=sharing',
                'series' => 'SERIESSERIESSERIES1234567890'], fn($folder) => libraryDriveVideos(substr($folder, 0, 6) === 'PELISP' ? 'PELIS' : 'SERIES', 'AIzaTEST', $drive));
            $missing = null;
            try { libraryDriveVideos('nope', 'AIzaTEST', $drive); } catch (InvalidArgumentException $e) { $missing = $e->getMessage(); }
            echo json_encode(['scan' => $scan, 'keys' => array_unique($asked), 'missing' => $missing,
                'ids' => [libraryDriveFolder('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp'), libraryDriveFolder('MENCIA MEDIA/PELICULAS')]]);''')
        films = {m['title']: m for m in result['scan']['movies']}
        self.assertEqual(set(films), {'Avatar', 'Raro Desconocido'})
        self.assertEqual(films['Avatar']['url'], 'https://www.googleapis.com/drive/v3/files/fAvatar?alt=media&key=AIzaTEST')
        self.assertEqual(films['Avatar']['year'], 2009)
        [paco] = result['scan']['series']
        self.assertEqual(paco['title'], 'Los Hombres de Paco')
        self.assertEqual([(e['season'], e['episode'], e['url'].split('/')[-1].split('?')[0]) for e in paco['episodes']], [(10, 1, 'fE1'), (10, 2, 'fE2')])
        self.assertEqual(result['keys'], ['AIzaTEST'])
        self.assertIn('Cualquier persona con el enlace', result['missing'])
        self.assertEqual(result['ids'], ['1AbCdEfGhIjKlMnOp', None])

    def test_publish_to_github_updates_the_file_with_its_sha(self):
        result = self.php(r'''
            putenv('CALAMAR_LIBRARY_DIR=' . sys_get_temp_dir()); putenv('CALAMAR_GITHUB_IMAGES_TOKEN=github_pat_TESTTOKEN1234567890');
            libraryWriteJson('calamar-library.json', ['sections' => []]);
            $calls = [];
            $github = function($method, $url, $body = null, $token = null) use (&$calls) {
                $calls[] = [$method, parse_url($url, PHP_URL_PATH), $body['sha'] ?? null, $token];
                return $method === 'GET' ? [200, ['sha' => 'abc', 'content' => base64_encode('old')]] : [200, []];
            };
            echo json_encode(['ok' => libraryPublishGithub($github), 'calls' => $calls]);''')
        self.assertTrue(result['ok'])
        self.assertEqual(result['calls'][1], ['PUT', '/repos/djyuanyo/Calamar-TV/contents/library/calamar-library.json', 'abc', 'github_pat_TESTTOKEN1234567890'])


if __name__ == '__main__':
    unittest.main()
