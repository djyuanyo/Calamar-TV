"""calamar-lineups.php: the API-Football match of an ESPN match, and its players' photos and ratings."""
import json
import os
import pathlib
import subprocess
import unittest

PHP = str(pathlib.Path(__file__).resolve().parents[1] / 'hosting/calamar-lineups.php')


def lit(value):
    """A PHP expression for a JSON value."""
    return 'json_decode(' + json.dumps(json.dumps(value, ensure_ascii=False)).replace('$', '\\$') + ', true)'


def php(code):
    return subprocess.check_output(['php', '-r', f'require {json.dumps(PHP)}; {code}'], text=True, env={**os.environ, 'CALAMAR_APIFOOTBALL_KEY': 'k'})


class LineupsTest(unittest.TestCase):
    def test_team_names_from_espn_find_their_api_football_match(self):
        fixtures = [
            {'fixture': {'id': 1}, 'teams': {'home': {'id': 10, 'name': 'Real Sociedad'}, 'away': {'id': 11, 'name': 'Real Madrid'}}},
            {'fixture': {'id': 2}, 'teams': {'home': {'id': 12, 'name': 'Atletico Madrid'}, 'away': {'id': 13, 'name': 'Alaves'}}},
            {'fixture': {'id': 3}, 'teams': {'home': {'id': 14, 'name': 'Athletic Club'}, 'away': {'id': 15, 'name': 'Getafe'}}},
            {'fixture': {'id': 4}, 'teams': {'home': {'id': 16, 'name': 'Real Betis'}, 'away': {'id': 17, 'name': 'Celta Vigo'}}},
        ]
        pick = lambda h, a: json.loads(php(f'$f = lineupsPick({lit(fixtures)}, {lit(h)}, {lit(a)}); echo json_encode($f ? $f["fixture"]["id"] : null);'))
        self.assertEqual(pick('Atlético Madrid', 'Alavés'), 2)
        self.assertEqual(pick('Athletic Club', 'Getafe'), 3)
        self.assertEqual(pick('Real Betis', 'Celta Vigo'), 4)
        self.assertEqual(pick('Real Sociedad', 'Real Madrid'), 1)
        # «Real» alone is not enough: Real Madrid at home is none of these matches.
        self.assertIsNone(pick('Real Madrid', 'Barcelona'))

    def test_players_keep_number_photo_and_rating(self):
        team = {'players': [
            {'player': {'name': 'Unai Simón', 'photo': 'https://media.api-sports.io/football/players/47.png'}, 'statistics': [{'games': {'number': 1, 'rating': '7.36'}}]},
            {'player': {'name': 'Suplente', 'photo': 'http://bad.example/x.png'}, 'statistics': [{'games': {'number': 22, 'rating': None}}]},
            {'player': {'name': 'Sin jugar', 'photo': ''}, 'statistics': [{'games': {'number': 12, 'rating': '0'}}]},
        ]}
        self.assertEqual(json.loads(php(f'echo json_encode(lineupsPlayers({lit(team)}));')), [
            {'number': '1', 'name': 'Unai Simón', 'photo': 'https://media.api-sports.io/football/players/47.png', 'rating': 7.4},
            {'number': '22', 'name': 'Suplente', 'photo': '', 'rating': None},
            {'number': '12', 'name': 'Sin jugar', 'photo': '', 'rating': None}])

    def test_before_kick_off_photos_come_from_the_published_line_up(self):
        lineups = [
            {'team': {'id': 10}, 'startXI': [{'player': {'id': 47, 'name': 'Unai Simón', 'number': 1}}], 'substitutes': [{'player': {'id': 0, 'name': 'Sin ficha', 'number': 13}}]},
            {'team': {'id': 11}, 'startXI': [{'player': {'id': 99, 'name': 'Courtois', 'number': 1}}], 'substitutes': []},
        ]
        empty = {'home': [], 'away': []}
        self.assertEqual(json.loads(php(f'echo json_encode(lineupsFill({lit(empty)}, {lit(lineups)}, 10));')), {
            'home': [{'number': '1', 'name': 'Unai Simón', 'photo': 'https://media.api-sports.io/football/players/47.png', 'rating': None},
                     {'number': '13', 'name': 'Sin ficha', 'photo': '', 'rating': None}],
            'away': [{'number': '1', 'name': 'Courtois', 'photo': 'https://media.api-sports.io/football/players/99.png', 'rating': None}]})
        # With statistics, ratings stay and only missing photos are taken from the line-up.
        known = {'home': [{'number': '1', 'name': 'Unai Simón', 'photo': '', 'rating': 7.4}], 'away': [{'number': '1', 'name': 'Courtois', 'photo': 'https://x/1.png', 'rating': 6.8}]}
        filled = json.loads(php(f'echo json_encode(lineupsFill({lit(known)}, {lit(lineups)}, 10));'))
        self.assertEqual(filled['home'], [{'number': '1', 'name': 'Unai Simón', 'photo': 'https://media.api-sports.io/football/players/47.png', 'rating': 7.4}])
        self.assertEqual(filled['away'], known['away'])

    def test_an_empty_answer_is_asked_again_sooner(self):
        code = ('$n = 0; $f = function () use (&$n) { $n++; return json_encode(["response" => []]); };'
                'lineupsApi("/fixtures/players?fixture=1&t=" . getmypid(), 1800, "k", $f, 0); lineupsApi("/fixtures/players?fixture=1&t=" . getmypid(), 1800, "k", $f, 0); echo $n;')
        self.assertEqual(php(code), '2')
        code = ('$n = 0; $f = function () use (&$n) { $n++; return json_encode(["response" => [1]]); };'
                'lineupsApi("/fixtures/players?fixture=2&t=" . getmypid(), 1800, "k", $f, 0); lineupsApi("/fixtures/players?fixture=2&t=" . getmypid(), 1800, "k", $f, 0); echo $n;')
        self.assertEqual(php(code), '1')

    def test_a_limited_api_answers_with_the_last_data_kept(self):
        code = ('$path = "/fixtures/players?fixture=3&t=" . getmypid();'
                'lineupsApi($path, 1800, "k", function () { return json_encode(["response" => [["team" => ["id" => 1]]]]); });'
                '$again = lineupsApi($path, 0, "k", function () { return json_encode(["errors" => ["rateLimit" => "Too many requests."]]); });'
                'echo json_encode($again["response"][0]["team"]["id"]);')
        self.assertEqual(php(code), '1')

    def test_statistics_get_espn_names(self):
        team = {'team': {'id': 10}, 'statistics': [{'type': 'Ball Possession', 'value': '61%'}, {'type': 'Total Shots', 'value': 14},
                {'type': 'Shots on Goal', 'value': 5}, {'type': 'Corner Kicks', 'value': None}, {'type': 'expected_goals', 'value': '1.2'}]}
        self.assertEqual(json.loads(php(f'echo json_encode(lineupsStats({lit(team)}));')), {'possessionPct': '61%', 'totalShots': '14', 'shotsOnTarget': '5'})

    def test_api_errors_are_told_in_its_own_words(self):
        out = subprocess.run(['php', '-r', f'require {json.dumps(PHP)}; lineupsApi("/fixtures?date=2099-01-01", 0, "k", function () {{ return json_encode(["errors" => ["plan" => "Free plans do not have access to this season."]]); }});'],
                             capture_output=True, text=True)
        self.assertIn('API-Football: Free plans do not have access to this season.', out.stdout)


if __name__ == '__main__':
    unittest.main()
