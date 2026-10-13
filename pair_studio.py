"""Generate a pairing code using the local launcher's credential; opens no browser."""
import json
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


def main():
    runtime = json.loads(Path(__file__).with_name('studio_runtime.json').read_text(encoding='utf-8'))
    parsed = urlsplit(runtime['url'])
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1':
        raise ValueError('Expected the local Studio URL.')
    request = Request(runtime['url'].split('#')[0] + 'api/pairing-code', data=b'',
                      headers={'X-Studio-Token': runtime['token']}, method='POST')
    with urlopen(request, timeout=5) as response:
        result = json.load(response)
    print('Studio pairing code: ' + result['code'])
    print('Enter it in Restore control session on the Studio page. Valid once for 10 minutes.')


if __name__ == '__main__':
    main()
