"""RoboAttis eight-joint desktop controller. Python 3.12 + Tk + pyserial."""
import json
import copy
import queue
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import serial
from serial.tools import list_ports
from serial_protocol import frame, parse_frame
from calibrator_motion import JOINT_SAFETY, apply_safety

PINS = (2, 3, 4, 5, 6, 7, 8, 9)
PIN_INDEX = {pin: i for i, pin in enumerate(PINS)}
IDENTITY = 'PONG,ROBOATTIS,NANO,ARMS,8,115200,D2-D9,V8'
NAMES = ['Left omoplate', 'Left rotate', 'Left shoulder', 'Left bicep',
         'Right omoplate', 'Right rotate', 'Right shoulder', 'Right bicep']
SESSION = Path(__file__).with_name('arm_desktop_session.json')


def defaults():
    return apply_safety([dict(pin=PINS[i], name=n, minUs=500, maxUs=2500, restUs=1500, reversed=False)
                        for i, n in enumerate(NAMES)])


def upgrade_session(data):
    """Migrate either previous wiring layout by joint, including recordings."""
    data = copy.deepcopy(data)
    if isinstance(data, dict) and data.get('format') == 'RoboAttis-Nano-Arms' and data.get('version') in (1, 2):
        old_pins = tuple(range(2, 10)) if data['version'] == 1 else (2, 4, 5, 6, 7, 8, 9, 10)
        remap = dict(zip(old_pins, PINS))
        profiles = data.get('servos')
        if (not isinstance(profiles, list) or len(profiles) != 8 or
            any(not isinstance(p, dict) or type(p.get('pin')) is not int or p['pin'] != old_pins[i] for i, p in enumerate(profiles))):
            raise ValueError('Unrecognized legacy pin mapping.')
        for i, p in enumerate(profiles): p['pin'] = PINS[i]
        sequence = data.get('sequence')
        if sequence is not None:
            if not isinstance(sequence, dict) or not isinstance(sequence.get('events'), list):
                raise ValueError('Invalid legacy recording.')
            for event in sequence['events']:
                if not isinstance(event, dict): raise ValueError('Invalid legacy event.')
                if event.get('type') == 'ALL_OFF': continue
                pin = event.get('pin')
                if type(pin) is not int or pin not in remap: raise ValueError('Invalid legacy event pin.')
                event['pin'] = remap[pin]
        data['version'] = 3
        data['servos'] = apply_safety(data['servos'])
    return validate(data)


def validate(data):
    if not isinstance(data, dict) or data.get('format') != 'RoboAttis-Nano-Arms' or data.get('version') != 3:
        raise ValueError('Expected a RoboAttis eight-joint session.')
    profiles = data.get('servos')
    if not isinstance(profiles, list) or len(profiles) != 8:
        raise ValueError('Expected eight servo profiles.')
    for i, p in enumerate(profiles):
        if not isinstance(p, dict) or type(p.get('pin')) is not int or p.get('pin') != PINS[i] or not isinstance(p.get('name'), str):
            raise ValueError('Invalid joint name or pin mapping.')
        if type(p.get('reversed', False)) is not bool:
            raise ValueError('Servo direction must be true or false.')
        if not all(type(p.get(k)) is int for k in ('minUs', 'maxUs', 'restUs')):
            raise ValueError('Pulse values must be whole numbers.')
        if not 500 <= p['minUs'] <= p['restUs'] <= p['maxUs'] <= 2500 or p['minUs'] == p['maxUs']:
            raise ValueError('Home must lie inside limits, within 500–2500 µs.')
        safety = JOINT_SAFETY.get(p['pin'])
        if safety and (p['minUs']<safety['min_us'] or p['maxUs']>safety['max_us'] or p['restUs']!=safety['home_us'] or p.get('reversed',False)):
            raise ValueError(f"D{p['pin']}: stay inside the tested left-arm limits; home and direction are fixed.")
    s = data.get('sequence')
    if s is not None:
        if not isinstance(s, dict) or type(s.get('duration')) is not int or not 100 <= s['duration'] <= 600000:
            raise ValueError('Invalid recording duration.')
        events = s.get('events')
        if not isinstance(events, list) or not 1 <= len(events) <= 15000:
            raise ValueError('Recording must contain 1–15000 events.')
        if events[0].get('type') != 'ALL_OFF' or events[0].get('at') != 0:
            raise ValueError('Recording must begin with outputs off.')
        previous = 0
        for e in events:
            if not isinstance(e, dict) or type(e.get('at')) is not int or not previous <= e['at'] <= s['duration']:
                raise ValueError('Invalid event timing.')
            previous = e['at']
            if e.get('type') == 'ALL_OFF':
                continue
            pin = e.get('pin')
            if type(pin) is not int or pin not in PIN_INDEX or e.get('type') not in ('SET', 'OFF'):
                raise ValueError('Invalid event pin or command.')
            p = profiles[PIN_INDEX[pin]]
            if e['type'] == 'SET' and (type(e.get('us')) is not int or not p['minUs'] <= e['us'] <= p['maxUs']):
                raise ValueError('Recording exceeds current calibrated limits.')
            if 'angleRange' in e or 'pulseRange' in e:
                angles = e.get('angleRange')
                if (e['type'] != 'SET' or not isinstance(angles, list) or len(angles) != 2 or
                    any(type(a) is not int or not -360000 <= a <= 360000 for a in angles) or
                    angles[0] == angles[1] or e.get('pulseRange') != [p['minUs'], p['maxUs']]):
                    raise ValueError('Recorded angle calibration does not match this joint.')
    return data


def command(action):
    if action['type'] == 'ALL_OFF':
        return 'ALL_OFF'
    if action['type'] == 'OFF':
        return f"OFF,{action['pin']}"
    if 'angleRange' in action:
        a, b = action['angleRange']
        lo, hi = action['pulseRange']
        angle = round(a + (action['us']-lo)*(b-a)/(hi-lo))
        return f"ANGLE,{action['pin']},{angle},{a},{b},{lo},{hi}"
    return f"SET,{action['pin']},{action['us']}"


def acknowledgement(action):
    line = command(action)
    if line.startswith('ANGLE,'):
        _, pin, angle, a, b, lo, hi = line.split(',')
        angle, a, b, lo, hi = map(int, (angle, a, b, lo, hi))
        numerator, denominator = (angle-a)*(hi-lo), b-a
        if denominator < 0: numerator, denominator = -numerator, -denominator
        pulse = lo + (numerator + denominator//2)//denominator
        return f'OK,{pin},{pulse}'
    return line.replace('SET,', 'OK,', 1)


class SerialLink:
    """Single serial owner; only one motion command awaits acknowledgement."""
    def __init__(self):
        self.events = queue.Queue()
        self.commands = queue.Queue()
        self.stopping = threading.Event()
        self.urgent_off = threading.Event()
        self.thread = None
        self.last_ui_tick = time.monotonic()
        self.retry_count = 0
        self.reconnect_count = 0
        self.bad_frames = 0
        self.last_rx = 0
        self.device_key = None
        self.io_recoveries = 0
        self.last_fault = ''
        self.connection_state = 'idle'
        self.mode = 'framed'
        self.in_flight = False

    def connect(self, port):
        if self.thread and self.thread.is_alive(): raise ValueError('Serial connection already running.')
        self.clear()
        self.stopping.clear()
        self.urgent_off.clear()
        self.device_key = next(((p.vid,p.pid,p.serial_number) for p in list_ports.comports()
                                if p.device == port and p.serial_number), None)
        self.thread = threading.Thread(target=self.run, args=(port,), daemon=True)
        self.thread.start()

    def send(self, action):
        self.commands.put(dict(action))

    def clear(self):
        while True:
            try:
                self.commands.get_nowait()
            except queue.Empty:
                break

    def off(self):
        self.clear()
        self.urgent_off.set()

    def close(self):
        self.off()
        self.stopping.set()

    def same_handle_io(self, operation):
        """Allow a brief driver hiccup without closing or resetting the Nano."""
        deadline = time.monotonic()+.3
        failed = False
        while True:
            try:
                result = operation()
                if failed: self.io_recoveries += 1
                return result
            except (serial.SerialException, OSError):
                failed = True
                if self.stopping.is_set() or time.monotonic() >= deadline: raise
                if self.device_key and not any((p.vid,p.pid,p.serial_number) == self.device_key
                                              for p in list_ports.comports()): raise
                if self.stopping.wait(.025): raise

    def run(self, port):
        delay = .5
        while not self.stopping.is_set():
            try:
                if self.device_key:
                    port = next((p.device for p in list_ports.comports()
                                 if (p.vid,p.pid,p.serial_number) == self.device_key), None)
                    if port is None: raise serial.SerialException('Nano USB device not present.')
                self.connection_state = 'connecting'
                self.run_session(port)
                break
            except (serial.SerialException, OSError, TimeoutError) as exc:
                self.clear()
                self.reconnect_count += 1
                absent = self.device_key and not any((p.vid,p.pid,p.serial_number) == self.device_key
                                                     for p in list_ports.comports())
                self.connection_state = 'usb-missing' if absent else 'recovering'
                self.last_fault = str(exc)
                reason = ('Nano USB device disappeared from Windows. Check servo supply, common ground and USB cable.'
                          if absent else 'Serial link interrupted: '+str(exc)+'.')
                self.events.put(('recovering', reason+' Waiting for the same Nano; outputs off.'))
                if self.stopping.wait(delay): break
                delay = min(3, delay*2)
            except Exception as exc:
                self.events.put(('error', str(exc)))
                break
        self.clear()
        self.connection_state = 'idle'
        self.events.put(('closed', 'Serial port closed.'))

    def run_session(self, port):
        dev = None
        try:
            dev = serial.Serial(None, 115200, timeout=.01, write_timeout=.5)
            # Configure control signals before opening; never toggle them for commands.
            dev.dtr = False
            dev.rts = False
            dev.port = port
            dev.open()
            def write(line):
                self.same_handle_io(lambda: dev.write((line+'\n').encode('ascii')))
            end = time.monotonic()+8
            next_ping = 0
            verified = False
            buffer = b''
            def read_lines():
                nonlocal buffer
                buffer += self.same_handle_io(lambda: dev.read(max(1, dev.in_waiting)))
                if len(buffer) > 4096:
                    raise RuntimeError('Oversized serial response.')
                lines = buffer.split(b'\n')
                buffer = lines.pop()
                return [line.decode('ascii', errors='replace').strip() for line in lines if line.strip()]
            while not self.stopping.is_set() and time.monotonic() < end and not verified:
                if time.monotonic() >= next_ping:
                    write('PING')
                    next_ping = time.monotonic()+.7
                for line in read_lines():
                    if line == IDENTITY:
                        verified = True
                    elif line.startswith('PONG,'):
                        write('ALL_OFF')
                        raise RuntimeError('Wrong firmware. Upload Nano Arms V8 for the reliable link.')
            if not verified:
                if self.stopping.is_set(): return
                raise TimeoutError('Nano identity not received.')
            # Clear duplicate cache and stale outputs before using framed commands.
            if self.mode == 'framed': write('ALL_OFF')
            sequence = 0
            pending = None
            recovering = True
            def transmit(payload, expected):
                nonlocal sequence, pending
                sequence = sequence % 65535 + 1
                wire = frame(sequence, payload) if self.mode == 'framed' else payload
                write(wire)
                pending = [sequence, expected, wire, time.monotonic(), 0]
                self.in_flight = True
            transmit('ALL_OFF', 'ALL_OFF')
            self.last_rx = time.monotonic()
            next_heartbeat = 0
            while not self.stopping.is_set():
                now = time.monotonic()
                if now-self.last_ui_tick > 3:
                    raise TimeoutError('Controller UI stopped responding; outputs disabled.')
                if self.urgent_off.is_set():
                    self.clear()
                    transmit('ALL_OFF', 'ALL_OFF')
                    self.urgent_off.clear()
                if now >= next_heartbeat:
                    write(frame(0, 'HEARTBEAT') if self.mode == 'framed' else 'HEARTBEAT')
                    next_heartbeat = now+.4
                for raw in read_lines():
                    if self.mode == 'framed' and raw == 'ALL_OFF': continue
                    if raw.startswith(('BOOT,', 'TIMEOUT,')) or raw == IDENTITY:
                        self.clear()
                        recovering = True
                        self.events.put(('reset', 'Nano restarted or timed out; outputs off.'))
                        if self.mode == 'framed': write('ALL_OFF')
                        transmit('ALL_OFF','ALL_OFF')
                        continue
                    decoded = (parse_frame(raw) if self.mode == 'framed' else
                               (0, raw) if raw == 'ALIVE' else
                               (pending[0], raw) if pending else None)
                    if decoded is None:
                        self.bad_frames += 1
                        continue
                    response_id, line = decoded
                    self.last_rx = time.monotonic()
                    if response_id == 0 and line == 'ALIVE': continue
                    if not pending or response_id != pending[0]: continue
                    if line.startswith('ERR,'):
                        self.clear()
                        recovering = True
                        self.events.put(('reset', 'Command rejected: '+line+'; outputs off.'))
                        transmit('ALL_OFF','ALL_OFF')
                        continue
                    if line == pending[1]:
                        self.events.put(('line', line))
                        pending = None
                        self.in_flight = False
                        if recovering:
                            recovering = False
                            self.connection_state = 'connected'
                            self.events.put(('connected', port))
                if pending and now-pending[3] > .35:
                    if pending[4] >= 3: raise TimeoutError('Command acknowledgement lost after retries.')
                    write(pending[2])
                    pending[3] = time.monotonic()
                    pending[4] += 1
                    self.retry_count += 1
                if now-self.last_rx > 2:
                    raise TimeoutError('Nano heartbeat lost.')
                if pending is None:
                    try:
                        a = self.commands.get_nowait()
                    except queue.Empty:
                        continue
                    if self.mode == 'direct' and a['type'] == 'SET':
                        transmit(f"SET,{a['pin']},{a['us']}", f"OK,{a['pin']},{a['us']}")
                    else:
                        transmit(command(a), acknowledgement(a))
        finally:
            self.in_flight = False
            if dev:
                try:
                    dev.write(b'ALL_OFF\n')
                except Exception:
                    pass
                try: dev.close()
                except Exception: pass


class App:
    def __init__(self, root):
        self.root = root
        root.title('RoboAttis · Both Arms · USB Serial Controller')
        root.geometry('1200x820')
        root.minsize(900, 650)
        self.link = SerialLink()
        self.profiles = defaults()
        self.sequence = None
        self.ready = False
        self.busy = False
        self.recording = False
        self.playing = False
        self.enabled = [False]*8
        self.positions = [1500]*8
        self.pending = {}
        self.loop = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value='Ready · choose the Nano USB port. No browser or web host required.')
        self.sequence_status = tk.StringVar(value='No recording yet')
        self.cards = []
        style = ttk.Style()
        style.theme_use('clam')
        style.configure('TFrame', background='#eef3f8')
        style.configure('TLabel', background='#eef3f8', foreground='#17314c')
        style.configure('TButton', padding=7)
        style.configure('Title.TLabel', font=('Segoe UI', 21, 'bold'))
        outer = ttk.Frame(root, padding=16)
        outer.pack(fill='both', expand=True)
        ttk.Label(outer, text='Both Arms Studio', style='Title.TLabel').pack(anchor='w')
        ttk.Label(outer, text='USB serial · 115200 baud · Nano V8 · D2–D9 · reliable link', padding=(0, 5)).pack(anchor='w')
        row = ttk.Frame(outer)
        row.pack(fill='x', pady=8)
        self.port = tk.StringVar()
        self.ports = ttk.Combobox(row, textvariable=self.port, width=40, state='readonly')
        self.ports.pack(side='left')
        self.refresh_button = ttk.Button(row, text='Refresh ports', command=self.refresh)
        self.refresh_button.pack(side='left', padx=6)
        self.connect_button = ttk.Button(row, text='Connect Nano', command=self.connect)
        self.connect_button.pack(side='left')
        self.stop_button = tk.Button(row, text='EMERGENCY OFF', bg='#a3213e', fg='white', font=('Segoe UI', 11, 'bold'), command=self.emergency)
        self.stop_button.pack(side='right')
        ttk.Label(outer, textvariable=self.status, wraplength=1120).pack(fill='x', pady=5)
        row = ttk.Frame(outer)
        row.pack(fill='x', pady=6)
        self.record_button = ttk.Button(row, text='● Record', command=self.record)
        self.finish_button = ttk.Button(row, text='Finish recording', command=self.finish)
        self.play_button = ttk.Button(row, text='▶ Play', command=self.play)
        self.hold_button = ttk.Button(row, text='Stop playback / hold', command=self.hold)
        for button in (self.record_button, self.finish_button, self.play_button, self.hold_button):
            button.pack(side='left', padx=(0, 6))
        self.loop_button = ttk.Checkbutton(row, text='Loop', variable=self.loop)
        self.loop_button.pack(side='left')
        self.home_button = ttk.Button(row, text='Home enabled joints', command=self.home_all)
        self.home_button.pack(side='right')
        ttk.Label(outer, textvariable=self.sequence_status).pack(anchor='w')
        row = ttk.Frame(outer)
        row.pack(fill='x', pady=8)
        self.file_buttons = []
        for label, action in [('Save session', self.save), ('Export JSON', self.export), ('Import JSON', self.import_file), ('Wiring guide', self.wiring)]:
            button = ttk.Button(row, text=label, command=action)
            button.pack(side='left', padx=(0, 6))
            self.file_buttons.append(button)
        notebook = ttk.Notebook(outer)
        notebook.pack(fill='both', expand=True)
        for side in range(2):
            page = ttk.Frame(notebook, padding=12)
            notebook.add(page, text='  '+('LEFT ARM · D2–D5' if side == 0 else 'RIGHT ARM · D6–D9')+'  ')
            for j in range(4):
                self.card(page, side*4+j, j)
            for n in range(2):
                page.columnconfigure(n, weight=1)
                page.rowconfigure(n, weight=1)
        ttk.Label(outer, text='Angles are not measured. Home is a saved pulse. Support arms: Emergency off releases holding force.', padding=(0, 8)).pack(anchor='w')
        self.refresh()
        if SESSION.exists():
            try:
                self.load(json.loads(SESSION.read_text(encoding='utf-8')))
            except Exception as e:
                self.status.set('Saved session could not load: '+str(e))
        self.sync()
        root.protocol('WM_DELETE_WINDOW', self.quit)
        root.after(10, self.tick)

    def card(self, parent, i, j):
        p = self.profiles[i]
        box = ttk.LabelFrame(parent, text=f"{NAMES[i]} · D{PINS[i]}", padding=12)
        box.grid(row=j//2, column=j%2, sticky='nsew', padx=6, pady=6)
        v = tk.DoubleVar(value=1500)
        label = ttk.Label(box, text='1500 µs · OFF', font=('Segoe UI', 15, 'bold'))
        label.pack(anchor='w')
        scale = ttk.Scale(box, from_=p['minUs'], to=p['maxUs'], variable=v, command=lambda x: self.slider(i, x))
        scale.pack(fill='x', pady=8)
        buttons = {}
        for labels in [[('enable', 'Enable at home', lambda: self.move(i, self.profiles[i]['restUs'])), ('off', 'Off', lambda: self.off(i))],
                       [('minus', '−5 µs', lambda: self.move(i, self.positions[i]-5)), ('plus', '+5 µs', lambda: self.move(i, self.positions[i]+5)),
                        ('home', 'Go home', lambda: self.move(i, self.profiles[i]['restUs']))],
                       [('sethome', 'Set here as home', lambda: self.set_home(i)), ('limits', 'Edit limits / home', lambda: self.edit(i))]]:
            row = ttk.Frame(box)
            row.pack(fill='x', pady=3)
            for key, text, action in labels:
                b = ttk.Button(row, text=text, command=action)
                b.pack(side='left', padx=(0, 5))
                buttons[key] = b
        info = ttk.Label(box, text='')
        info.pack(anchor='w', pady=5)
        self.cards.append(dict(v=v, scale=scale, label=label, info=info, buttons=buttons))

    def refresh(self):
        ports = [f'{p.device} — {p.description}' for p in list_ports.comports()]
        self.ports['values'] = ports
        if self.port.get() not in ports:
            self.port.set(ports[0] if ports else '')

    def connect(self):
        if self.busy:
            self.link.close()
            self.status.set('Disconnecting…')
            self.ready = False
        else:
            if not self.port.get():
                return self.status.set('No serial device found. Plug in the Nano and refresh.')
            self.busy = True
            self.link.connect(self.port.get().split(' — ')[0])
            self.status.set('Opening USB port and verifying Arms V8 firmware…')
        self.sync()

    def data(self):
        return dict(format='RoboAttis-Nano-Arms', version=3, servos=self.profiles, sequence=self.sequence)

    def sequence_valid(self):
        try:
            validate(self.data())
            return self.sequence is not None
        except ValueError:
            return False

    def sync(self):
        def state(w, on):
            w.configure(state='normal' if on else 'disabled')
        state(self.refresh_button, not self.busy)
        self.ports.configure(state='disabled' if self.busy else 'readonly')
        self.connect_button.configure(text='Disconnect' if self.busy else 'Connect Nano')
        state(self.stop_button, self.ready)
        state(self.record_button, self.ready and not self.recording and not self.playing)
        state(self.finish_button, self.recording)
        state(self.play_button, self.ready and not self.recording and not self.playing and self.sequence_valid())
        state(self.hold_button, self.playing)
        state(self.home_button, self.ready and any(self.enabled) and not self.playing and not self.recording)
        state(self.loop_button, not self.playing and not self.recording)
        for b in self.file_buttons:
            state(b, not self.playing and not self.recording)
        for i, c in enumerate(self.cards):
            p = self.profiles[i]
            c['scale'].configure(from_=p['minUs'], to=p['maxUs'])
            state(c['scale'], self.ready and self.enabled[i] and not self.playing)
            c['label'].configure(text=f"{self.positions[i]} µs · {'ON' if self.enabled[i] else 'OFF'}")
            c['info'].configure(text=f"Limits {p['minUs']}–{p['maxUs']} µs  |  Home {p['restUs']} µs")
            for key, b in c['buttons'].items():
                on = self.ready and not self.playing
                if key == 'enable': on = on and not self.enabled[i]
                elif key == 'off': on = self.ready
                elif key == 'limits': on = not self.enabled[i] and not self.recording and not self.playing
                else: on = on and self.enabled[i]
                if key == 'sethome': on = on and not self.recording and PINS[i] not in JOINT_SAFETY
                state(b, on)

    def dispatch(self, a, capture=True):
        if not self.ready:
            return
        if a['type'] == 'ALL_OFF':
            self.enabled = [False]*8
        else:
            i = PIN_INDEX.get(a['pin'])
            if i is None:
                raise ValueError('Invalid servo pin.')
            if a['type'] == 'SET':
                p = self.profiles[i]
                if not p['minUs'] <= a['us'] <= p['maxUs']:
                    raise ValueError('Pulse outside calibrated limits.')
                self.positions[i] = a['us']
                self.cards[i]['v'].set(a['us'])
                self.enabled[i] = True
            else:
                self.enabled[i] = False
        self.link.send(a)
        if capture and self.recording:
            at = round((time.monotonic()-self.record_start)*1000)
            if at >= 600000 or len(self.events) >= 15000:
                self.finish()
            else:
                self.events.append(dict(a, at=at))

    def move(self, i, us):
        if self.ready and not self.playing:
            p = self.profiles[i]
            self.pending.pop(i, None)
            self.dispatch(dict(type='SET', pin=PINS[i], us=max(p['minUs'], min(p['maxUs'], int(us)))))
            self.sync()

    def slider(self, i, value):
        if self.ready and self.enabled[i] and not self.playing:
            self.pending[i] = round(float(value))

    def off(self, i):
        if self.playing:
            self.hold()
        self.pending.pop(i, None)
        self.link.clear()
        self.dispatch(dict(type='OFF', pin=PINS[i]))
        self.sync()

    def home_all(self):
        for i, on in enumerate(self.enabled):
            if on:
                self.move(i, self.profiles[i]['restUs'])

    def set_home(self, i):
        if PINS[i] in JOINT_SAFETY:
            self.status.set('The tested left-arm home is fixed. Use the saved home position.')
            return
        self.profiles[i]['restUs'] = self.positions[i]
        self.save()
        self.sync()

    def edit(self, i):
        p = self.profiles[i]
        win = tk.Toplevel(self.root)
        win.title(NAMES[i]+' · pulse calibration')
        win.transient(self.root)
        win.grab_set()
        values = {}
        for row, (key, label) in enumerate([('minUs', 'Minimum µs'), ('maxUs', 'Maximum µs'), ('restUs', 'Saved home µs')]):
            ttk.Label(win, text=label).grid(row=row, column=0, padx=15, pady=10)
            values[key] = tk.StringVar(value=str(p[key]))
            ttk.Entry(win, textvariable=values[key]).grid(row=row, column=1, padx=15, pady=10)
        def apply():
            try:
                candidate = dict(p, **{k: int(v.get()) for k, v in values.items()})
                test = self.data().copy()
                test['servos'] = [dict(x) for x in self.profiles]
                test['servos'][i] = candidate
                test['sequence'] = None
                validate(test)
                self.profiles[i] = candidate
                self.positions[i] = candidate['restUs']
                self.cards[i]['v'].set(candidate['restUs'])
                self.sync()
                if not self.sequence_valid() and self.sequence:
                    self.sequence_status.set('Recording exceeds new limits. Restore limits or record again.')
                win.destroy()
            except Exception as e:
                messagebox.showerror('Invalid calibration', str(e), parent=win)
        ttk.Button(win, text='Apply', command=apply).grid(row=3, column=1, pady=12)

    def record(self):
        if not self.ready or self.playing:
            return
        self.flush()
        self.recording = True
        self.record_start = time.monotonic()
        self.events = [dict(type='ALL_OFF', at=0)]
        self.events += [dict(type='SET', pin=PINS[i], us=self.positions[i], at=0) for i, on in enumerate(self.enabled) if on]
        self.sync()

    def finish(self):
        if self.recording:
            self.recording = False
            duration = max(100, min(600000, round((time.monotonic()-self.record_start)*1000)))
            self.sequence = dict(duration=duration, events=self.events)
            self.sequence_status.set(f'Recording ready · {duration/1000:.1f} seconds · {len(self.events)} commands')
            self.sync()

    def play(self):
        if not self.ready or not self.sequence_valid():
            return
        self.pending.clear()
        self.link.clear()
        self.playing = True
        self.play_start = time.monotonic()
        self.play_index = 0
        self.sync()

    def hold(self):
        self.playing = False
        self.pending.clear()
        self.link.clear()
        self.sequence_status.set('Playback stopped. Last sent positions are held.')
        self.sync()

    def emergency(self):
        self.playing = False
        self.pending.clear()
        self.finish()
        self.enabled = [False]*8
        self.link.off()
        self.status.set('Emergency off requested · support arms as holding force releases.')
        self.sync()

    def flush(self):
        moves, self.pending = self.pending, {}
        for i, us in moves.items():
            if self.ready and self.enabled[i] and not self.playing:
                self.move(i, us)

    def tick(self):
        self.link.last_ui_tick = time.monotonic()
        while True:
            try:
                kind, text = self.link.events.get_nowait()
            except queue.Empty:
                break
            self.on_link_event(kind, text)
            if kind == 'connected':
                self.ready = True
                self.refresh()
                self.port.set(next((p for p in self.ports['values'] if p.split(' — ')[0] == text), text))
                self.status.set(f'{text} connected · V8 verified · D2–D9 · outputs off')
            elif kind in ('error', 'reset', 'closed', 'recovering'):
                self.playing = False
                self.pending.clear()
                self.finish()
                self.enabled = [False]*8
                self.ready = False
                if kind == 'closed': self.busy = False
                if kind != 'closed': self.status.set(text)
                elif not self.status.get().startswith('Emergency'): self.status.set(self.status.get()+' · disconnected')
            elif kind == 'line' and text == 'ALL_OFF':
                pass
            self.sync()
        self.flush()
        now = time.monotonic()
        if self.recording:
            self.sequence_status.set(f'Recording · {now-self.record_start:.1f} seconds · {len(self.events)} commands')
            if now-self.record_start >= 600: self.finish()
        if self.playing:
            elapsed = round((now-self.play_start)*1000)
            events = self.sequence['events']
            # Do not flood serial or catch up a delayed playback with stale movements.
            if self.play_index < len(events) and elapsed-events[self.play_index]['at'] > 500:
                self.emergency()
                self.status.set('Playback stopped: serial timing fell behind.')
            else:
                while self.play_index < len(events) and events[self.play_index]['at'] <= elapsed and self.link.commands.qsize() < 2:
                    self.dispatch(events[self.play_index], capture=False)
                    self.play_index += 1
                self.sequence_status.set(f'Playing · {elapsed/1000:.1f} / {self.sequence["duration"]/1000:.1f} seconds')
                if self.play_index == len(events) and elapsed >= self.sequence['duration'] and self.link.commands.empty():
                    if self.loop.get(): self.play_start, self.play_index = now, 0
                    else:
                        self.playing = False
                        self.sequence_status.set('Playback complete · final pose held')
                self.sync()
        self.root.after(10, self.tick)

    def on_link_event(self, kind, text):
        """Presentation hook running on the Tk thread."""
        pass

    def save(self):
        try:
            data = validate(self.data())
            temporary = SESSION.with_suffix('.tmp')
            temporary.write_text(json.dumps(data, indent=2), encoding='utf-8')
            temporary.replace(SESSION)
            self.status.set('Session saved on this computer: limits, homes and recording.')
        except Exception as e:
            messagebox.showerror('Save failed', str(e))

    def export(self):
        try:
            data = validate(self.data())
            name = filedialog.asksaveasfilename(defaultextension='.json', initialfile='both-arms-session.json', filetypes=[('JSON', '*.json')])
            if name: Path(name).write_text(json.dumps(data, indent=2), encoding='utf-8')
        except Exception as e:
            messagebox.showerror('Export failed', str(e))

    def load(self, data):
        data = upgrade_session(data)
        self.pending.clear()
        if self.busy: self.link.off()
        self.enabled = [False]*8
        self.profiles = data['servos']
        self.sequence = data.get('sequence')
        self.positions = [p['restUs'] for p in self.profiles]
        for i, c in enumerate(self.cards): c['v'].set(self.positions[i])
        self.sequence_status.set('Saved recording ready' if self.sequence else 'No recording yet')
        self.sync()

    def import_file(self):
        name = filedialog.askopenfilename(filetypes=[('JSON session', '*.json')])
        if not name: return
        try:
            if Path(name).stat().st_size > 4000000: raise ValueError('File exceeds 4 MB.')
            self.load(json.loads(Path(name).read_text(encoding='utf-8')))
            self.status.set('Session imported; outputs off. Save session to retain it.')
        except Exception as e:
            messagebox.showerror('Import failed', str(e))

    def wiring(self):
        messagebox.showinfo('Nano expansion board wiring',
            'Robot\'s LEFT: D2 omoplate · D3 rotate · D4 shoulder · D5 bicep\n'
            'Robot\'s RIGHT: D6 omoplate · D7 rotate · D8 shoulder · D9 bicep\n\n'
            'S = signal (white/orange/yellow); G = common ground (black/brown).\n'
            'Red servo power → external regulated supply matching servo ratings.\n'
            'Supply negative → servo grounds and Nano GND. Do not power eight arm servos from USB.\n\n'
            'D0/D1 reserved for serial. Fingers and wrists are not included.\n'
            'Home stores a command; no position feedback or home switches are present.')

    def quit(self):
        self.emergency()
        self.link.close()
        self.root.after(100, self.wait_close)

    def wait_close(self):
        if self.link.thread and self.link.thread.is_alive():
            self.root.after(100, self.wait_close)
        else:
            self.root.destroy()


if __name__ == '__main__':
    window = tk.Tk()
    App(window)
    window.mainloop()
