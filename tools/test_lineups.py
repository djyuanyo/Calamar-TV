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

    def test_api_errors_are_told_in_its_own_words(self):
        out = subprocess.run(['php', '-r', f'require {json.dumps(PHP)}; lineupsApi("/fixtures?date=2099-01-01", 0, "k", function () {{ return json_encode(["errors" => ["plan" => "Free plans do not have access to this season."]]); }});'],
                             capture_output=True, text=True)
        self.assertIn('API-Football: Free plans do not have access to this season.', out.stdout)


if __name__ == '__main__':
    unittest.main()
