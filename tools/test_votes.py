"""calamar-votes.php: the visitors' 1X2 poll kept on the hosting."""
import datetime
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

PHP = pathlib.Path(__file__).resolve().parents[1] / 'hosting/calamar-votes.php'


@unittest.skipUnless(shutil.which('php'), 'Requires PHP CLI')
class VotesTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.data = pathlib.Path(self.folder.name) / 'votes'
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0)); self.port = probe.getsockname()[1]
        self.server = subprocess.Popen(['php', '-S', f'127.0.0.1:{self.port}', '-t', str(PHP.parent)],
                                      env={**os.environ, 'CALAMAR_VOTES_DIR': str(self.data)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)

    def tearDown(self):
        self.server.terminate(); self.server.wait(); self.folder.cleanup()

    def call(self, query='', body=None, origin='https://djyuanyo.github.io'):
        request = urllib.request.Request(f'http://127.0.0.1:{self.port}/calamar-votes.php{query}', data=None if body is None else json.dumps(body).encode(),
                                         headers={'Content-Type': 'text/plain', **({'Origin': origin} if origin else {})})
        try:
            with urllib.request.urlopen(request, timeout=10) as answer:
                return answer.status, json.loads(answer.read()), answer.headers
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b'{}'), error.headers

    def match(self, teams):
        return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)).strftime('%Y-%m-%d') + '-' + teams

    def test_votes_are_counted_once_per_voter_and_can_change(self):
        match = self.match('villarreal-espanyol')
        self.assertEqual(self.call(f'?match={match}')[1], {'h': 0, 'd': 0, 'a': 0})
        status, totals, headers = self.call(body={'match': match, 'voter': 'A' * 24, 'pick': '1'})
        self.assertEqual((status, totals), (200, {'h': 1, 'd': 0, 'a': 0}))
        self.assertEqual(headers['Access-Control-Allow-Origin'], 'https://djyuanyo.github.io')
        self.assertEqual(self.call(body={'match': match, 'voter': 'A' * 24, 'pick': '2'})[1], {'h': 0, 'd': 0, 'a': 1})
        self.assertEqual(self.call(body={'match': match, 'voter': 'B' * 24, 'pick': 'X'}, origin='')[1], {'h': 0, 'd': 1, 'a': 1}, 'the app sends no origin')
        self.assertEqual(self.call(f'?match={match}')[1], {'h': 0, 'd': 1, 'a': 1})
        stored = (self.data / f'{match}.json').read_text()
        self.assertNotIn('A' * 24, stored, 'voter ids are kept only as hashes')

    def test_invalid_votes_and_other_sites_are_refused(self):
        match = self.match('elche-valencia')
        for body in [{'match': match, 'voter': 'A' * 24, 'pick': '3'}, {'match': match, 'voter': 'short', 'pick': '1'},
                     {'match': '2020-01-01-elche-valencia', 'voter': 'A' * 24, 'pick': '1'}, {'match': match + '/../x', 'voter': 'A' * 24, 'pick': '1'},
                     {'match': 'Elche', 'voter': 'A' * 24, 'pick': '1'}]:
            self.assertEqual(self.call(body=body)[0], 400, body)
        self.assertEqual(self.call('?match=../../etc/passwd')[0], 400)
        self.assertEqual(self.call(f'?match={match}', origin='https://evil.example')[0], 403)
        self.assertEqual(self.call(f'?match={match}')[1], {'h': 0, 'd': 0, 'a': 0})

    def test_one_connection_cannot_flood_the_poll(self):
        match = self.match('getafe-sevilla')
        codes = [self.call(body={'match': match, 'voter': f'{n:024d}'.replace('0', 'C'), 'pick': '1'})[0] for n in range(70)]
        self.assertIn(429, codes)
        self.assertLessEqual(self.call(f'?match={match}')[1]['h'], 60)


if __name__ == '__main__':
    unittest.main()
