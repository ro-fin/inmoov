"""Open the authenticated local calibrator after its service is ready."""
import json
import os
import subprocess
import webbrowser
from pathlib import Path
from urllib.parse import urlsplit

def open_visible_browser(url):
    """Use a visible Edge window on Windows, even without a default HTTP app."""
    roots = (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'))
    for root in roots:
        if not root:
            continue
        edge = Path(root) / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'
        if edge.is_file():
            subprocess.Popen([str(edge), '--new-window', url], close_fds=True)
            return
    if not webbrowser.open(url, new=1):
        raise RuntimeError('No browser could open Studio. Install Microsoft Edge or set a default browser.')

def main():
    runtime=json.loads(Path(__file__).with_name('studio_runtime.json').read_text(encoding='utf-8'))
    url=runtime['url']
    parsed=urlsplit(url)
    if parsed.scheme!='http' or parsed.hostname!='127.0.0.1':
        raise ValueError('Expected the local Studio URL.')
    open_visible_browser(url+'&tab=control&view=calibrator')

if __name__=='__main__': main()
