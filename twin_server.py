"""Local InMoov Studio: existing controller, HTTP presentation, no remote hosting."""
import argparse
import json
import queue
import secrets
import threading
import time
import webbrowser
from collections import deque
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tkinter as tk

from arm_desktop import App, NAMES, SESSION, PIN_INDEX, validate
from calibrator_motion import GestureRun, GESTURE_NAMES, safety_rules, PINS as MOTION_PINS, apply_safety
from session_pairing import PairingCodes

ROOT = Path(__file__).parent
WEB = ROOT / 'digital_twin'


class Studio(App):
    def __init__(self, root):
        self.activity = deque(maxlen=40)
        self.ack = [None] * 8
        self.confirmed_enabled = [False] * 8
        self.jobs = queue.Queue()
        self.snapshot = {}
        self.last_client = 0
        self.browser_lost = False
        self.angle_ranges = [None] * 8
        self.gesture = None
        self.gesture_status = 'Choose a hand sign. Left arm · D2–D5.'
        super().__init__(root)
        self.link.mode = 'direct'
        root.withdraw()
        self.status.set('Preview ready. Connect your Nano when you want to control the robot.')
        self.root.after(20, self.pump)

    def log(self, label, stage, pin=None, us=None):
        self.activity.appendleft(dict(time=time.strftime('%H:%M:%S'), label=label,
                                       stage=stage, pin=pin, us=us, id=time.monotonic_ns()))

    def on_link_event(self, kind, text):
        if kind == 'line':
            fields = text.split(',')
            if fields[0] in ('OK', 'STATE') and len(fields) == 3:
                try:
                    pin, us = int(fields[1]), int(fields[2])
                except ValueError:
                    return
                if pin in PIN_INDEX and (us == 0 or 500 <= us <= 2500):
                    i = PIN_INDEX[pin]
                    self.confirmed_enabled[i] = us != 0
                    if us:
                        self.ack[i] = us
                    if fields[0] == 'OK':
                        if self.gesture:
                            self.gesture.acknowledge(pin,us)
                        self.log(f'{NAMES[i]} · {us} µs', 'Acknowledged', pin, us)
            elif fields[0] == 'OFF' and len(fields) == 2 and fields[1].isdigit():
                pin = int(fields[1])
                if pin in PIN_INDEX:
                    self.confirmed_enabled[PIN_INDEX[pin]] = False
                    self.log(NAMES[PIN_INDEX[pin]] + ' released', 'Acknowledged', pin)
            elif text == 'ALL_OFF':
                self.confirmed_enabled = [False] * 8
                self.log('All outputs off', 'Acknowledged')
        elif kind in ('error', 'reset', 'closed', 'connected', 'recovering'):
            if self.gesture:
                self.gesture = None
                self.gesture_status = 'Gesture stopped: connection changed. Start again explicitly.'
            self.ack = [None] * 8
            self.confirmed_enabled = [False] * 8
            self.log(text, 'Connected' if kind == 'connected' else 'Connection')

    def dispatch(self, action, capture=True):
        if action['type'] == 'SET' and 'angleRange' not in action:
            if action.get('pin') not in PIN_INDEX: raise ValueError('Invalid servo pin; use D2–D9.')
            i = PIN_INDEX[action['pin']]
            if i>=4 and self.angle_ranges[i] is not None:
                action = dict(action, angleRange=list(self.angle_ranges[i]),
                              pulseRange=[self.profiles[i]['minUs'], self.profiles[i]['maxUs']])
        ready = self.ready
        super().dispatch(action, capture)
        if ready:
            pin = action.get('pin')
            self.log((NAMES[PIN_INDEX[pin]] if pin else 'All joints') + ' · ' + action['type'],
                     'Queued', pin, action.get('us'))

    def sync(self):
        super().sync()
        self.snapshot = dict(
            ready=self.ready, busy=self.busy, status=self.status.get(),
            profiles=[dict(p) for p in self.profiles], positions=list(self.positions),
            enabled=list(self.enabled), acknowledged=list(self.ack),
            confirmedEnabled=list(self.confirmed_enabled),
            recording=self.recording, playing=self.playing or self.gesture is not None,
            gesture=self.gesture.state() if self.gesture else dict(active=False),
            gestureStatus=self.gesture_status, gestures=list(GESTURE_NAMES), safety=safety_rules(),
            sequenceStatus=self.sequence_status.get(), sequenceValid=self.sequence_valid(),
            loop=self.loop.get(), activity=list(self.activity),
            ports=list(self.ports['values']), port=self.port.get(), session=self.data())
        self.snapshot['link'] = dict(retries=self.link.retry_count, reconnects=self.link.reconnect_count,
                                    badFrames=self.link.bad_frames, browserPaused=self.browser_lost,
                                    ioRecoveries=self.link.io_recoveries, state=self.link.connection_state,
                                    lastFault=self.link.last_fault, mode=self.link.mode,inFlight=self.link.in_flight)

    def flush(self):
        # Keep only the newest slider value until the serial worker has room.
        if self.link.commands.qsize() < 2:
            super().flush()

    def pump(self):
        for _ in range(16):
            try:
                body, result = self.jobs.get_nowait()
            except queue.Empty:
                break
            try:
                result.put((200, self.action(body)))
            except (ValueError, KeyError, TypeError) as exc:
                result.put((400, dict(error=str(exc))))
            except Exception as exc:
                self.log(str(exc), 'Error')
                result.put((500, dict(error=str(exc))))
        if self.busy and time.monotonic() - self.last_client > 6.0 and not self.browser_lost:
            self.browser_lost = True
            self.emergency()
            self.status.set('Browser heartbeat paused. Outputs off; USB connection kept open.')
            self.log('Browser heartbeat paused; outputs off', 'Connection')
        elif self.browser_lost and time.monotonic() - self.last_client <= 6.0:
            self.browser_lost = False
            self.log('Browser heartbeat restored; outputs remain off', 'Connection')
        if self.gesture:
            try:
                if not self.ready:
                    raise RuntimeError('Gesture stopped: Nano connection unavailable.')
                values=self.gesture.next_frame(time.monotonic())
                if values is not None:
                    for pin,us in zip(MOTION_PINS,values):
                        self.dispatch(dict(type='SET',pin=pin,us=us),capture=False)
                self.gesture_status = self.gesture.state()['label']+' · '+self.gesture.state()['phase'].replace('_',' ')+' · cycle '+str(self.gesture.cycles+1)
                if self.gesture.finished:
                    self.gesture_status='Home commands acknowledged · gesture complete · outputs releasing.'
                    self.gesture=None
                    for pin in MOTION_PINS:
                        self.dispatch(dict(type='OFF',pin=pin),capture=False)
            except (RuntimeError,ValueError) as exc:
                self.emergency()
                self.gesture_status=str(exc)
        self.sync()
        self.root.after(10, self.pump)

    def action(self, body):
        if not isinstance(body, dict):
            raise ValueError('Expected an action object.')
        name = body.get('action')
        if self.gesture and name not in ('emergency','disconnect','gesture_stop','gesture_home','gesture_loop'):
            raise ValueError('Stop the hand sign before manual control, recording or editing settings.')
        if name == 'refresh':
            self.refresh()
        elif name == 'connect':
            if self.busy:
                raise ValueError('Disconnect the current device first.')
            port = body.get('port')
            if port not in list(self.ports['values']):
                raise ValueError('Select an available Nano port.')
            mode = body.get('mode', 'direct')
            if mode not in ('direct','framed'): raise ValueError('Unknown serial mode.')
            self.link.mode = mode
            self.port.set(port)
            self.last_client = time.monotonic()
            self.browser_lost = False
            self.connect()
        elif name == 'disconnect':
            self.emergency()
            self.link.close()
            self.ready = False
        elif name == 'gesture':
            if not self.ready or self.recording or self.playing:
                raise ValueError('Connect the Nano and finish recording/playback first.')
            if body.get('name') not in GESTURE_NAMES or type(body.get('loop',False)) is not bool:
                raise ValueError('Choose a supported hand sign and loop setting.')
            if self.pending or not self.link.commands.empty() or self.link.in_flight:
                raise ValueError('Wait for the last command acknowledgement before starting a hand sign.')
            if any(self.enabled[4:]) or any(self.confirmed_enabled[4:]):
                raise ValueError('Release the right arm before running left-arm gestures.')
            unknown=any(not self.confirmed_enabled[i] or self.ack[i] is None for i in range(4))
            if unknown and body.get('confirmedHome') is not True:
                raise ValueError('Confirm the left arm is physically at home before starting.')
            start=tuple(self.ack[i] if self.confirmed_enabled[i] and self.ack[i] is not None else self.profiles[i]['restUs'] for i in range(4))
            candidate=GestureRun(body['name'],self.profiles,start,body.get('loop',False),time.monotonic())
            self.pending.clear()
            self.link.clear()
            self.angle_ranges[:4]=[None]*4
            self.gesture=candidate
            self.gesture_status=GESTURE_NAMES[body['name']]+' · starting'
        elif name == 'gesture_stop':
            self.emergency()
            self.gesture_status='Hand sign stopped · outputs off requested.'
        elif name == 'gesture_home':
            if not self.ready or self.recording or self.playing:
                raise ValueError('Connect the Nano and finish recording/playback first.')
            if self.gesture:
                start=self.gesture.last_target
            else:
                if any(not self.confirmed_enabled[i] or self.ack[i] is None for i in range(4)) and body.get('confirmedHome') is not True:
                    raise ValueError('Released joints have unknown positions. Confirm physical home first.')
                start=tuple(self.ack[i] if self.confirmed_enabled[i] and self.ack[i] is not None else self.profiles[i]['restUs'] for i in range(4))
            self.pending.clear()
            self.link.clear()
            self.gesture=GestureRun('hi',self.profiles,start,now=time.monotonic(),home_only=True)
            self.gesture_status='Returning left arm home.'
        elif name == 'gesture_loop':
            if type(body.get('value')) is not bool:
                raise ValueError('Loop must be true or false.')
            if self.gesture and not self.gesture.home_only:
                self.gesture.loop=body['value']
        elif name == 'restore_safety':
            if any(self.enabled) or self.recording or self.playing:
                raise ValueError('Release outputs before restoring safety settings.')
            self.profiles=apply_safety(self.profiles)
            self.angle_ranges[:4]=[None]*4
            self.positions=[p['restUs'] for p in self.profiles]
            for i,c in enumerate(self.cards): c['v'].set(self.positions[i])
            self.status.set('Tested left-arm limits and homes restored. Save to keep them.')
        elif name == 'emergency':
            self.emergency()
            self.log('Emergency off requested', 'Requested')
        elif name in ('move', 'enable', 'off', 'home', 'sethome'):
            if not self.ready:
                raise ValueError('Connect the Nano first.')
            i = body.get('index')
            if type(i) is not int or not 0 <= i < 8:
                raise ValueError('Unknown arm joint.')
            if self.playing and name != 'off':
                raise ValueError('Stop playback before manual control.')
            if name == 'off':
                self.off(i)
            elif name == 'sethome':
                if i<4:
                    raise ValueError('Left-arm homes are fixed to the tested safety settings.')
                if not self.enabled[i] or self.recording:
                    raise ValueError('Enable the joint and finish recording first.')
                self.set_home(i)
            else:
                if name == 'move' and not self.enabled[i]:
                    raise ValueError('Enable the selected joint first.')
                us = body.get('us') if name == 'move' else self.profiles[i]['restUs']
                if type(us) is not int or not self.profiles[i]['minUs'] <= us <= self.profiles[i]['maxUs']:
                    raise ValueError('Pulse outside the calibrated limits.')
                # Backpressure: coalesce sliders and never enqueue an unbounded stream.
                angle_range = body.get('angleRange')
                if angle_range is not None:
                    if (not isinstance(angle_range, list) or len(angle_range) != 2 or
                        any(type(a) is not int or not -360000 <= a <= 360000 for a in angle_range) or
                        angle_range[0] == angle_range[1]):
                        raise ValueError('Set two distinct calibrated angle endpoints first.')
                    self.angle_ranges[i] = list(angle_range)
                if name == 'move':
                    self.pending[i] = us
                else:
                    self.move(i, us)
        elif name == 'calibrate':
            i = body.get('index')
            if type(i) is not int or not 0 <= i < 8:
                raise ValueError('Unknown arm joint.')
            if self.enabled[i] or self.recording or self.playing:
                raise ValueError('Release this joint and stop recording/playback before editing limits.')
            candidate = dict(self.profiles[i])
            candidate['reversed'] = body.get('reversed', candidate.get('reversed', False))
            for key in ('minUs', 'maxUs', 'restUs'):
                candidate[key] = body[key]
            data = self.data().copy()
            data['servos'] = [dict(p) for p in self.profiles]
            data['servos'][i] = candidate
            data['sequence'] = None
            validate(data)
            self.profiles[i] = candidate
            self.angle_ranges[i] = None
            self.positions[i] = candidate['restUs']
            self.cards[i]['v'].set(candidate['restUs'])
            self.status.set('Calibration updated. Save session to keep these settings.')
        elif name == 'record':
            if not self.ready or self.playing or self.recording:
                raise ValueError('Connect the Nano and stop playback before recording.')
            self.record()
        elif name == 'finish':
            self.finish()
        elif name == 'play':
            if not self.ready or self.recording or self.playing or not self.sequence_valid():
                raise ValueError('Connect the Nano and choose a valid recording.')
            self.play()
        elif name == 'hold':
            self.hold()
        elif name == 'loop':
            if self.playing or self.recording:
                raise ValueError('Stop recording/playback before changing Loop.')
            if type(body.get('value')) is not bool:
                raise ValueError('Loop must be true or false.')
            self.loop.set(body['value'])
        elif name == 'save':
            if self.playing or self.recording:
                raise ValueError('Finish recording/playback first.')
            data = validate(self.data())
            tmp = SESSION.with_suffix('.tmp')
            tmp.write_text(json.dumps(data, indent=2), encoding='utf-8')
            tmp.replace(SESSION)
            self.status.set('Session saved on this computer.')
        elif name == 'import':
            if self.recording or self.playing:
                raise ValueError('Finish recording/playback first.')
            self.load(body['session'])
            self.status.set('Session imported. Outputs off.')
        else:
            raise ValueError('Unknown action.')
        self.sync()
        return self.snapshot

    def emergency(self):
        self.gesture=None
        self.gesture_status='Hand signs stopped · outputs off requested.'
        super().emergency()


class StudioServer(ThreadingHTTPServer):
    # Browser module/model requests arrive in bursts, sometimes from several tabs.
    request_queue_size = 128
    def __init__(self, *args, **kwargs):
        self.pairing = PairingCodes()
        super().__init__(*args, **kwargs)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def __init__(self, *args, studio, token, **kwargs):
        self.studio, self.token = studio, token
        super().__init__(*args, directory=str(WEB), **kwargs)

    def log_message(self, *_):
        pass

    def end_headers(self):
        path=self.path.split('?',1)[0]
        if not path.startswith('/api/') and (path=='/' or path.endswith(('.html','.js','.css','.json'))):
            # Keep display modules consistent after a local update. Large meshes keep normal caching.
            self.send_header('Cache-Control','no-store')
        super().end_headers()

    def json(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorized(self):
        port = self.server.server_address[1]
        host = self.headers.get('Host')
        origin = self.headers.get('Origin')
        return (host == f'127.0.0.1:{port}'
                and (origin is None or origin == f'http://127.0.0.1:{port}')
                and secrets.compare_digest(self.headers.get('X-Studio-Token', ''), self.token))

    def do_GET(self):
        if self.path == '/api/heartbeat':
            if not self.authorized(): return self.json(403, dict(error='Session token required.'))
            self.studio.last_client = time.monotonic()
            return self.json(200, dict(alive=True))
        if self.path == '/api/state':
            if not self.authorized():
                return self.json(403, dict(error='Open Studio from its launcher.'))
            self.studio.last_client = time.monotonic()
            return self.json(200, self.studio.snapshot)
        if self.path.startswith('/api/'):
            return self.json(404, dict(error='Unknown route.'))
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/pair':
            origin = f'http://127.0.0.1:{self.server.server_address[1]}'
            if self.headers.get('Host') != origin[7:] or self.headers.get('Origin') != origin:
                return self.json(403, dict(error='Pair from the local Studio page.'))
            try:
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 1024: raise ValueError()
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict): raise ValueError()
            except (ValueError, json.JSONDecodeError):
                return self.json(400, dict(error='Enter the eight-digit pairing code.'))
            if not self.server.pairing.redeem(body.get('code')):
                return self.json(403, dict(error='Code invalid, expired or already used. Generate a new local pairing code.'))
            return self.json(200, dict(token=self.token))
        if not self.authorized():
            return self.json(403, dict(error='Session token required.'))
        if self.path == '/api/pairing-code':
            return self.json(200, self.server.pairing.issue())
        if self.path != '/api/action':
            return self.json(404, dict(error='Unknown route.'))
        try:
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 4_000_000:
                raise ValueError('Invalid request size.')
            body = json.loads(self.rfile.read(length))
            result = queue.Queue(maxsize=1)
            self.studio.jobs.put((body, result))
            status, response = result.get(timeout=5)
        except (ValueError, json.JSONDecodeError):
            return self.json(400, dict(error='Invalid JSON request.'))
        except queue.Empty:
            return self.json(503, dict(error='Controller unavailable.'))
        return self.json(status, response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    # Reuse a running Studio rather than starting two serial owners.
    import urllib.request
    launcher = ROOT / 'studio_runtime.json'
    if launcher.exists():
        try:
            old = json.loads(launcher.read_text())
            req = urllib.request.Request(old['url'].split('#')[0] + 'api/state',
                                         headers={'X-Studio-Token': old['token']})
            with urllib.request.urlopen(req, timeout=1) as response:
                json.load(response)
            if not args.no_browser:
                webbrowser.open(old['url'])
            return
        except Exception:
            pass
    root = tk.Tk()
    root.withdraw()
    studio = Studio(root)
    token = secrets.token_urlsafe(32)
    try:
        server = StudioServer(('127.0.0.1', args.port),
                                    partial(Handler, studio=studio, token=token))
    except OSError:
        root.destroy()
        raise RuntimeError(f'Port {args.port} is occupied. Close the old Studio or select another port.')
    server.daemon_threads = True
    url = f'http://127.0.0.1:{args.port}/#token={token}'
    launcher.write_text(json.dumps(dict(url=url, token=token)), encoding='utf-8')
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if not args.no_browser:
        webbrowser.open(url)
    try:
        root.mainloop()
    finally:
        studio.link.close()
        server.shutdown()


if __name__ == '__main__':
    main()
