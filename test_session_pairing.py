import json
import threading
import unittest
from functools import partial
from http.client import HTTPConnection
from types import SimpleNamespace

from session_pairing import PairingCodes
from twin_server import Handler, StudioServer


class PairingTests(unittest.TestCase):
    def test_expiry_reuse_and_attempt_limit(self):
        clock = [0]
        codes = PairingCodes(lambda: clock[0])
        first = codes.issue()['code']
        self.assertTrue(codes.redeem(first))
        self.assertFalse(codes.redeem(first))
        expired = codes.issue()['code']
        clock[0] = 600
        self.assertFalse(codes.redeem(expired))
        valid = codes.issue()['code']
        for _ in range(5):
            self.assertFalse(codes.redeem('bad'))
        self.assertFalse(codes.redeem(valid))
        self.assertTrue(codes.redeem(codes.issue()['code']))

    def test_only_one_concurrent_redemption_succeeds(self):
        codes = PairingCodes()
        code = codes.issue()['code']
        results = []
        workers = [threading.Thread(target=lambda: results.append(codes.redeem(code))) for _ in range(8)]
        for worker in workers: worker.start()
        for worker in workers: worker.join()
        self.assertEqual(sum(results), 1)

    def test_http_pairing_requires_local_code_and_same_origin(self):
        # No serial controller, hardware queue, or browser is created in this test.
        studio = SimpleNamespace(snapshot={'enabled': [False]*8}, last_client=0)
        server = StudioServer(('127.0.0.1', 0), partial(Handler, studio=studio, token='test-secret'))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        port = server.server_address[1]
        origin = f'http://127.0.0.1:{port}'

        def request(method, path, body=None, headers=None):
            connection = HTTPConnection('127.0.0.1', port, timeout=3)
            try:
                connection.request(method, path, json.dumps(body) if body is not None else None, headers or {})
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()

        try:
            self.assertEqual(request('POST', '/api/pairing-code')[0], 403)
            status, issued = request('POST', '/api/pairing-code', headers={'X-Studio-Token': 'test-secret'})
            self.assertEqual(status, 200)
            code = issued['code']
            self.assertEqual(request('POST', '/api/pair', {'code': code})[0], 403)
            self.assertEqual(request('POST', '/api/pair', {'code': code}, {'Origin': 'https://example.com'})[0], 403)
            self.assertEqual(request('GET', '/api/state')[0], 403)
            status, paired = request('POST', '/api/pair', {'code': code}, {'Origin': origin})
            self.assertEqual(status, 200)
            self.assertEqual(request('POST', '/api/pair', {'code': code}, {'Origin': origin})[0], 403)
            status, state = request('GET', '/api/state', headers={'X-Studio-Token': paired['token']})
            self.assertEqual(status, 200)
            self.assertEqual(state['enabled'], [False]*8)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


if __name__ == '__main__':
    unittest.main()
