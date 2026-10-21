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


if __name__ == '__main__':
    unittest.main()
