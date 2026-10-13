import copy
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import arm_desktop as app
from serial_protocol import frame, parse_frame


class FakeSerial:
    def __init__(self, *args, **kwargs):
        self.buffer = bytearray()
        self.sent = []
        self.closed = False
        self.wires = []
        self.applied = []
        self.cache = {}
        self.drop_reply = False
        self.corrupt_reply = False
        self.open_signals = None

    def open(self):
        self.open_signals = (self.dtr,self.rts)

    @property
    def in_waiting(self):
        return len(self.buffer)

    def write(self, data):
        line = data.decode().strip()
        self.wires.append(line)
        parsed = parse_frame(line)
        sequence = None
        if parsed: sequence,line=parsed
        self.sent.append(line)
        response = None
        if line == 'PING': response = app.IDENTITY
        elif line == 'ALL_OFF': response = 'ALL_OFF'
        elif line == 'HEARTBEAT': response = 'ALIVE'
        elif line.startswith('SET,'): response = line.replace('SET,', 'OK,', 1)
        elif line.startswith('ANGLE,'):
            _, pin, angle, a, b, lo, hi = line.split(',')
            angle, a, b, lo, hi = map(int, (angle, a, b, lo, hi))
            response = f'OK,{pin},{lo + int((angle-a)*(hi-lo)/(b-a)+.5)}'
        elif line.startswith('OFF,'): response = line
        if response:
            if sequence is not None:
                if line.startswith(('SET,','ANGLE,')):
                    if sequence not in self.cache: self.applied.append(line)
                    self.cache[sequence] = response
                response = frame(sequence,response)
                if line.startswith(('SET,','ANGLE,')) and self.drop_reply:
                    self.drop_reply=False
                    return
                if line.startswith(('SET,','ANGLE,')) and self.corrupt_reply:
                    self.corrupt_reply=False
                    response=response[:-1]+('0' if response[-1]!='0' else '1')
            self.buffer.extend((response+'\n').encode())

    def read(self, count):
        if not self.buffer: time.sleep(.005)
        result = bytes(self.buffer[:count])
        del self.buffer[:count]
        return result

    def close(self):
        self.closed = True


class Tests(unittest.TestCase):
    def session(self):
        return dict(format='RoboAttis-Nano-Arms', version=3, servos=app.defaults(), sequence=None)

    def test_profiles_and_home_bounds(self):
        s = self.session()
        app.validate(s)
        s['servos'][0]['restUs'] = 2600
        with self.assertRaises(ValueError): app.validate(s)

    def test_sequence_validation(self):
        s = self.session()
        s['sequence'] = dict(duration=1000, events=[dict(type='ALL_OFF', at=0), dict(type='SET', pin=2, us=1550, at=100)])
        app.validate(s)
        for mutation in [dict(pin=10), dict(pin=11), dict(us=2600), dict(at=-1)]:
            bad = copy.deepcopy(s)
            bad['sequence']['events'][1].update(mutation)
            with self.assertRaises(ValueError): app.validate(bad)

    def test_wire_protocol(self):
        self.assertEqual(app.command(dict(type='SET', pin=2, us=1540)), 'SET,2,1540')
        self.assertEqual(app.command(dict(type='OFF', pin=9)), 'OFF,9')

    def test_calibrated_angle_protocol_and_reversed_joint(self):
        for limits, angle in [([0, 80000], 40000), ([80000, 0], 40000), ([-25000, 55000], 15000)]:
            action = dict(type='SET', pin=2, us=1500, angleRange=limits, pulseRange=[1400, 1600])
            self.assertEqual(app.command(action), f'ANGLE,2,{angle},{limits[0]},{limits[1]},1400,1600')
            self.assertEqual(app.acknowledgement(action), 'OK,2,1500')

    def test_import_rejects_incompatible_angle_calibration(self):
        s = self.session()
        s['sequence'] = dict(duration=1000, events=[dict(type='ALL_OFF', at=0),
            dict(type='SET', pin=2, us=1500, at=100, angleRange=[0, 80000], pulseRange=[1400, 1600])])
        with self.assertRaises(ValueError): app.validate(s)

    def test_serial_identity_acknowledgement_and_shutdown(self):
        fake = FakeSerial()
        with patch.object(app.serial, 'Serial', return_value=fake):
            link = app.SerialLink()
            link.connect('FAKE')
            end = time.monotonic()+1
            while time.monotonic() < end and 'ALL_OFF' not in fake.sent: time.sleep(.01)
            self.assertIn('PING', fake.sent)
            self.assertIn('ALL_OFF', fake.sent)
            self.assertFalse(any(x.startswith('SET') for x in fake.sent))
            link.send(dict(type='SET', pin=2, us=1500))
            end = time.monotonic()+1
            while time.monotonic() < end and 'SET,2,1500' not in fake.sent: time.sleep(.01)
            self.assertIn('SET,2,1500', fake.sent)
            link.close()
            link.thread.join(2)
            self.assertFalse(link.thread.is_alive())
            self.assertTrue(fake.closed)
            self.assertEqual(fake.sent[-1], 'ALL_OFF')

    def test_off_discards_unsent_commands(self):
        link = app.SerialLink()
        link.send(dict(type='SET', pin=2, us=1500))
        link.off()
        self.assertTrue(link.commands.empty())
        self.assertTrue(link.urgent_off.is_set())

    def test_lost_and_corrupted_ack_retry_same_frame(self):
        for failure in ('drop_reply','corrupt_reply'):
            fake=FakeSerial()
            with patch.object(app.serial,'Serial',return_value=fake), patch.object(app.list_ports,'comports',return_value=[]):
                link=app.SerialLink(); link.connect('FAKE')
                deadline=time.monotonic()+2
                while not any(parse_frame(w) and parse_frame(w)[1]=='ALL_OFF' for w in fake.wires) and time.monotonic()<deadline:
                    link.last_ui_tick=time.monotonic(); time.sleep(.01)
                setattr(fake,failure,True)
                link.send(dict(type='SET',pin=2,us=1600))
                deadline=time.monotonic()+2
                while link.retry_count==0 and time.monotonic()<deadline:
                    link.last_ui_tick=time.monotonic(); time.sleep(.01)
                time.sleep(.04)
                wires=[w for w in fake.wires if parse_frame(w) and parse_frame(w)[1]=='SET,2,1600']
                self.assertEqual(len(wires),2)
                self.assertEqual(wires[0],wires[1])
                self.assertEqual(fake.applied,['SET,2,1600'])
                self.assertTrue(link.thread.is_alive())
                self.assertEqual(link.reconnect_count,0)
                link.close(); link.thread.join(2)

    def test_usb_failure_reconnects_without_replaying_motion(self):
        devices=[SimpleNamespace(device='COM3',vid=0x403,pid=0x6001,serial_number='NANO-A')]
        class BrokenSerial(FakeSerial):
            def read(self,count):
                if 'SET,2,1600' in self.sent:
                    devices[:]=[SimpleNamespace(device='COM8',vid=0x403,pid=0x6001,serial_number='OTHER'),
                                SimpleNamespace(device='COM4',vid=0x403,pid=0x6001,serial_number='NANO-A')]
                    raise app.serial.SerialException('USB removed')
                return super().read(count)
        first,second=BrokenSerial(),FakeSerial()
        with patch.object(app.serial,'Serial',side_effect=[first,second]) as factory, patch.object(app.list_ports,'comports',side_effect=lambda:devices):
            link=app.SerialLink(); link.connect('COM3')
            deadline=time.monotonic()+2
            while 'ALL_OFF' not in first.sent and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic(); time.sleep(.01)
            link.send(dict(type='SET',pin=2,us=1600))
            deadline=time.monotonic()+3
            while 'ALL_OFF' not in second.sent and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic(); time.sleep(.01)
            self.assertIn('ALL_OFF',second.sent)
            self.assertFalse(any(s.startswith(('SET,','ANGLE,')) for s in second.sent))
            self.assertEqual(link.reconnect_count,1)
            self.assertEqual([first.port,second.port],['COM3','COM4'])
            self.assertEqual(first.open_signals,(False,False))
            self.assertEqual(second.open_signals,(False,False))
            self.assertTrue(link.thread.is_alive())
            link.close(); link.thread.join(2)

    def test_emergency_off_cancels_retry_of_pending_motion(self):
        fake=FakeSerial()
        with patch.object(app.serial,'Serial',return_value=fake), patch.object(app.list_ports,'comports',return_value=[]):
            link=app.SerialLink();link.connect('FAKE')
            deadline=time.monotonic()+2
            while 'ALL_OFF' not in fake.sent and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
            fake.drop_reply=True
            link.send(dict(type='SET',pin=2,us=1600))
            deadline=time.monotonic()+2
            while 'SET,2,1600' not in fake.sent and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
            link.off()
            end=time.monotonic()+.5
            while time.monotonic()<end:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
            self.assertEqual(fake.sent.count('SET,2,1600'),1)
            self.assertIn('ALL_OFF',fake.sent[fake.sent.index('SET,2,1600')+1:])
            self.assertTrue(link.thread.is_alive())
            link.close();link.thread.join(2)

    def test_frame_corruption_and_sequence_validation(self):
        wire=frame(65535,'ANGLE,9,135000,270000,0,500,2500')
        self.assertEqual(parse_frame(wire),(65535,'ANGLE,9,135000,270000,0,500,2500'))
        self.assertIsNone(parse_frame(wire.replace('135000','134000')))
        self.assertIsNone(parse_frame('@1,ALL_OFF*0000'))

    def test_brief_driver_error_keeps_existing_serial_handle(self):
        class HiccupSerial(FakeSerial):
            def __init__(self):
                super().__init__(); self.failed=False
            @property
            def in_waiting(self):
                if 'SET,2,1600' in self.sent and not self.failed:
                    self.failed=True
                    raise app.serial.SerialException('Temporary ClearCommError')
                return super().in_waiting
        fake=HiccupSerial()
        with patch.object(app.serial,'Serial',return_value=fake) as factory, patch.object(app.list_ports,'comports',return_value=[]):
            link=app.SerialLink();link.connect('FAKE')
            deadline=time.monotonic()+2
            while 'ALL_OFF' not in fake.sent and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
            link.send(dict(type='SET',pin=2,us=1600))
            deadline=time.monotonic()+2
            acknowledged=False
            while not acknowledged and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic()
                while not link.events.empty():
                    kind,text=link.events.get_nowait()
                    if kind=='line' and text=='OK,2,1600':acknowledged=True
                time.sleep(.01)
            self.assertTrue(acknowledged)
            self.assertEqual(factory.call_count,1)
            self.assertEqual(link.reconnect_count,0)
            self.assertEqual(link.io_recoveries,1)
            self.assertFalse(fake.closed)
            self.assertTrue(link.thread.is_alive())
            link.close();link.thread.join(2)

    def test_compatibility_mode_sends_direct_pulses_on_one_handle(self):
        fake=FakeSerial()
        with patch.object(app.serial,'Serial',return_value=fake) as factory, patch.object(app.list_ports,'comports',return_value=[]):
            link=app.SerialLink();link.mode='direct';link.connect('FAKE')
            deadline=time.monotonic()+2
            while link.connection_state!='connected' and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
            self.assertEqual(link.connection_state,'connected')
            for pin in app.PINS:
                link.send(dict(type='SET',pin=pin,us=1550,angleRange=[270000,0],pulseRange=[500,2500]))
            deadline=time.monotonic()+2
            while len(fake.applied)<8 and time.monotonic()<deadline:
                link.last_ui_tick=time.monotonic();time.sleep(.01)
                # Direct writes are also absolute setpoints.
                if sum(s.startswith('SET,') for s in fake.sent)==8: break
            self.assertEqual([s for s in fake.sent if s.startswith('SET,')],[f'SET,{pin},1550' for pin in app.PINS])
            self.assertFalse(any(w.startswith(('@','ANGLE,')) for w in fake.wires))
            self.assertEqual(factory.call_count,1)
            self.assertEqual(fake.open_signals,(False,False))
            self.assertTrue(link.thread.is_alive())
            self.assertEqual(link.reconnect_count,0)
            link.close();link.thread.join(2)

    def test_all_eight_270_degree_servos_full_pulse_travel(self):
        profiles = app.defaults()
        for i in range(8):
            expected = [(1389,1604),(1204,1685),(1093,1856),(1004,1604)][i] if i<4 else (500,2500)
            self.assertEqual((profiles[i]['minUs'], profiles[i]['maxUs']), expected)
            for angle, pulse in [(0, 500), (135000, 1500), (270000, 2500)]:
                action = dict(type='SET', pin=app.PINS[i], us=pulse, angleRange=[0, 270000], pulseRange=[500, 2500])
                self.assertEqual(app.command(action), f'ANGLE,{app.PINS[i]},{angle},0,270000,500,2500')
                self.assertEqual(app.acknowledgement(action), f'OK,{app.PINS[i]},{pulse}')

    def test_legacy_session_migrates_by_joint_without_mutation(self):
        old = self.session()
        old['version'] = 1
        for i, p in enumerate(old['servos']):
            p.update(pin=i+2, restUs=1500+i)
        old['sequence'] = dict(duration=1000, events=[dict(type='ALL_OFF', at=0),
            dict(type='SET', pin=3, us=1600, at=100), dict(type='OFF', pin=9, at=200)])
        new = app.upgrade_session(old)
        self.assertEqual(new['version'], 3)
        self.assertEqual([p['pin'] for p in new['servos']], list(app.PINS))
        self.assertEqual([p['restUs'] for p in new['servos']], [1600,1500,1626,1604,1504,1505,1506,1507])
        self.assertEqual([e.get('pin') for e in new['sequence']['events']], [None,3,9])
        self.assertEqual(old['servos'][1]['pin'], 3)
        self.assertEqual(app.upgrade_session(new), new)

    def test_skip_d3_session_migrates_profiles_and_recordings(self):
        old = self.session()
        old['version'] = 2
        for i, pin in enumerate((2,4,5,6,7,8,9,10)):
            old['servos'][i].update(pin=pin, restUs=1500+i)
        old['sequence'] = dict(duration=1000, events=[dict(type='ALL_OFF', at=0),
            dict(type='SET', pin=4, us=1600, at=100), dict(type='OFF', pin=10, at=200)])
        new = app.upgrade_session(old)
        self.assertEqual([p['pin'] for p in new['servos']], list(range(2,10)))
        self.assertEqual([p['restUs'] for p in new['servos']], [1600,1500,1626,1604,1504,1505,1506,1507])
        self.assertEqual([e.get('pin') for e in new['sequence']['events']], [None,3,9])
        self.assertEqual(old['servos'][1]['pin'], 4)


if __name__ == '__main__':
    unittest.main()
