"""No hardware required: test controller semantics using the existing serial fake."""
import queue
import time
import tkinter as tk
import unittest
from unittest.mock import patch
from pathlib import Path
from twin_server import Studio, Handler
from test_arm_desktop import FakeSerial

class StudioTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.app = Studio(self.root)

    def tearDown(self):
        self.app.link.close()
        if self.app.link.thread:
            self.app.link.thread.join(2)
        self.root.destroy()

    def connected(self):
        self.app.ready = True
        self.app.busy = True
        self.app.last_client = time.monotonic()

    def test_commands_do_not_claim_acknowledgement(self):
        self.connected()
        self.app.action(dict(action='enable', index=0))
        self.assertTrue(self.app.enabled[0])
        self.assertIsNone(self.app.ack[0])
        self.app.on_link_event('line', 'OK,2,1500')
        self.assertEqual(self.app.ack[0], 1500)
        self.assertTrue(self.app.confirmed_enabled[0])
        self.app.on_link_event('line', 'OFF,2')
        self.assertFalse(self.app.confirmed_enabled[0])
        self.assertEqual(self.app.ack[0], 1500)

    def test_offline_and_invalid_commands_are_rejected(self):
        with self.assertRaises(ValueError):
            self.app.action(dict(action='enable', index=0))
        self.connected()
        for body in [dict(action='move', index=0, us=1500),
                     dict(action='enable', index=10),
                     dict(action='enable', index=True)]:
            with self.assertRaises(ValueError):
                self.app.action(body)
        self.app.action(dict(action='enable', index=0))
        with self.assertRaises(ValueError):
            self.app.action(dict(action='move', index=0, us=2600))

    def test_browser_loss_disables_without_closing_usb(self):
        self.connected()
        self.app.action(dict(action='enable', index=0))
        self.app.last_client = time.monotonic() - 7
        self.app.pump()
        self.assertTrue(self.app.ready)
        self.assertFalse(any(self.app.enabled))
        self.assertTrue(self.app.link.urgent_off.is_set())
        self.assertFalse(self.app.link.stopping.is_set())
        self.app.last_client = time.monotonic()
        self.app.pump()
        self.assertFalse(self.app.browser_lost)
        self.assertFalse(any(self.app.enabled))

    def test_short_browser_gap_does_not_break_link(self):
        self.connected()
        self.app.enabled[0]=True
        self.app.last_client=time.monotonic()-3
        self.app.pump()
        self.assertTrue(self.app.ready)
        self.assertTrue(self.app.enabled[0])

    def test_calibration_bounds_and_active_joint_guard(self):
        with self.assertRaises(ValueError):
            self.app.action(dict(action='calibrate', index=0, minUs=1500, maxUs=1400, restUs=1450))
        self.app.action(dict(action='calibrate', index=0, minUs=1450, maxUs=1604, restUs=1600))
        self.connected()
        self.app.action(dict(action='enable', index=0))
        with self.assertRaises(ValueError):
            self.app.action(dict(action='calibrate', index=0, minUs=1400, maxUs=1600, restUs=1600))

    def test_slider_backpressure_retains_latest_value(self):
        self.connected()
        self.app.action(dict(action='enable', index=0))
        self.app.link.send(dict(type='SET', pin=4, us=1500))
        self.app.action(dict(action='move', index=0, us=1510))
        self.app.action(dict(action='move', index=0, us=1540))
        self.app.flush()
        self.assertEqual(self.app.pending[0], 1540)
        self.assertEqual(self.app.link.commands.qsize(), 2)
        self.app.link.clear()
        self.app.flush()
        self.assertEqual(self.app.link.commands.get_nowait()['us'], 1540)
        self.assertFalse(self.app.pending)

    def test_servo_direction_is_independent_and_locked_when_enabled(self):
        self.app.angle_ranges[4] = [0,270000]
        self.app.action(dict(action='calibrate',index=4,minUs=500,maxUs=2500,restUs=1500,reversed=True))
        self.assertTrue(self.app.profiles[4]['reversed'])
        self.assertFalse(self.app.profiles[0].get('reversed', False))
        self.assertIsNone(self.app.angle_ranges[4])
        self.connected()
        self.app.action(dict(action='enable',index=4,angleRange=[270000,0]))
        command=self.app.link.commands.get_nowait()
        self.assertEqual(command['pin'],6)
        self.assertEqual(command['angleRange'],[270000,0])
        with self.assertRaises(ValueError):
            self.app.action(dict(action='calibrate',index=4,minUs=500,maxUs=2500,restUs=1500,reversed=False))

    def test_angle_commands_keep_calibrated_pulse_bounds(self):
        self.connected()
        self.app.action(dict(action='enable', index=0, angleRange=[-25000, 55000]))
        action = self.app.link.commands.get_nowait()
        self.assertNotIn('angleRange', action)  # Tested left arm preserves exact pulse commands.
        self.assertEqual(action['us'], self.app.profiles[0]['restUs'])
        with self.assertRaises(ValueError):
            self.app.action(dict(action='move', index=0, us=1500, angleRange=[0, 0]))

    def test_consecutive_pin_routing_and_unused_pin_rejection(self):
        self.connected()
        with self.assertRaises(ValueError):
            self.app.dispatch(dict(type='SET', pin=10, us=1500))
        self.app.on_link_event('line', 'OK,10,1600')
        self.assertTrue(all(v is None for v in self.app.ack))
        self.app.action(dict(action='enable', index=7))
        self.assertEqual(self.app.link.commands.get_nowait()['pin'], 9)
        self.app.on_link_event('line', 'OK,9,1600')
        self.assertEqual(self.app.ack[7], 1600)
        self.assertTrue(self.app.confirmed_enabled[7])
        self.app.action(dict(action='enable', index=1))
        self.assertEqual(self.app.link.commands.get_nowait()['pin'], 3)
        self.app.on_link_event('line', 'OK,3,1550')
        self.assertEqual(self.app.ack[1], 1550)

    def test_end_to_end_fake_serial_confirmation(self):
        fake = FakeSerial()
        with patch('arm_desktop.serial.Serial', return_value=fake):
            self.app.link.connect('FAKE')
            self.app.busy = True
            self.app.last_client = time.monotonic()
            end = time.monotonic() + 2
            while not self.app.ready and time.monotonic() < end:
                self.root.update()
                time.sleep(.01)
            self.assertTrue(self.app.ready)
            self.app.action(dict(action='enable', index=3))
            end = time.monotonic() + 2
            while self.app.ack[3] is None and time.monotonic() < end:
                self.root.update()
                time.sleep(.01)
            self.assertEqual(self.app.ack[3], self.app.profiles[3]['restUs'])
            self.app.action(dict(action='emergency'))
            self.assertFalse(any(self.app.enabled))
            self.assertFalse(self.app.pending)

    def test_live_gesture_guards_and_stop_cancel_queued_motion(self):
        self.connected()
        with self.assertRaises(ValueError): self.app.action(dict(action='gesture',name='hi',loop=True))
        self.app.action(dict(action='gesture',name='hi',loop=True,confirmedHome=True))
        self.app.pump()
        self.assertTrue(self.app.snapshot['gesture']['active'])
        self.assertTrue(self.app.snapshot['playing'])
        self.assertEqual(self.app.link.commands.qsize(),4)
        self.assertFalse(any(self.app.enabled[4:]))
        with self.assertRaises(ValueError): self.app.action(dict(action='enable',index=4))
        with self.assertRaises(ValueError): self.app.action(dict(action='calibrate',index=0,minUs=500,maxUs=2500,restUs=1600))
        self.app.action(dict(action='gesture_stop'))
        self.assertIsNone(self.app.gesture)
        self.assertTrue(self.app.link.commands.empty())
        self.assertTrue(self.app.link.urgent_off.is_set())
        self.assertFalse(any(self.app.enabled))

    def test_gesture_fault_and_browser_loss_do_not_resume_motion(self):
        self.connected()
        self.app.action(dict(action='gesture',name='sequence',confirmedHome=True))
        self.app.on_link_event('reset','Nano reset')
        self.assertIsNone(self.app.gesture)
        self.app.on_link_event('connected','FAKE')
        self.assertIsNone(self.app.gesture)
        self.app.link.clear()
        self.app.action(dict(action='gesture',name='hi',confirmedHome=True))
        self.app.last_client=time.monotonic()-7
        self.app.pump()
        self.assertIsNone(self.app.gesture)
        self.assertFalse(any(self.app.enabled))

    def test_gesture_frames_preserve_exact_pulses_and_loop_can_change_live(self):
        self.connected()
        self.app.action(dict(action='gesture',name='left',loop=True,confirmedHome=True))
        self.app.pump()
        commands=[self.app.link.commands.get_nowait() for _ in range(4)]
        self.assertEqual([c['pin'] for c in commands],[2,3,4,5])
        self.assertTrue(all('angleRange' not in c for c in commands))
        for c in commands: self.app.on_link_event('line',f"OK,{c['pin']},{c['us']}")
        self.assertFalse(self.app.gesture.pending)
        self.app.action(dict(action='gesture_loop',value=False))
        self.assertFalse(self.app.gesture.loop)
        self.app.action(dict(action='gesture_home'))
        self.assertTrue(self.app.gesture.home_only)
        self.assertFalse(self.app.gesture.loop)

    def test_safety_import_and_in_flight_guards(self):
        self.connected()
        self.app.link.in_flight=True
        with self.assertRaises(ValueError): self.app.action(dict(action='gesture',name='hi',confirmedHome=True))
        self.app.link.in_flight=False
        self.app.enabled[4]=True
        with self.assertRaises(ValueError): self.app.action(dict(action='gesture',name='hi',confirmedHome=True))
        self.app.enabled[4]=False
        with self.assertRaises(ValueError): self.app.action(dict(action='calibrate',index=3,minUs=500,maxUs=2500,restUs=1604))
        with self.assertRaises(ValueError): self.app.action(dict(action='sethome',index=3))

    def test_complete_gesture_uses_existing_serial_owner_and_releases_at_home(self):
        fake=FakeSerial()
        with patch('arm_desktop.serial.Serial',return_value=fake) as factory:
            self.app.link.connect('FAKE')
            self.app.busy=True
            end=time.monotonic()+2
            while not self.app.ready and time.monotonic()<end:
                self.app.last_client=time.monotonic()
                self.root.update()
                time.sleep(.005)
            self.assertTrue(self.app.ready)
            self.app.action(dict(action='gesture',name='left',confirmedHome=True))
            end=time.monotonic()+25
            while (self.app.gesture or any(self.app.confirmed_enabled[:4])) and time.monotonic()<end:
                self.app.last_client=time.monotonic()
                self.root.update()
                time.sleep(.005)
            self.assertIsNone(self.app.gesture,self.app.gesture_status)
            self.assertFalse(any(self.app.confirmed_enabled))
            self.assertEqual(self.app.ack[:4],[1600,1500,1626,1604])
            moves=[s.split(',') for s in fake.sent if s.startswith('SET,')]
            self.assertGreater(len(moves),40)
            for _,pin,pulse in moves:
                i=int(pin)-2
                self.assertLess(i,4)
                self.assertTrue(self.app.profiles[i]['minUs']<=int(pulse)<=self.app.profiles[i]['maxUs'])
            self.assertEqual(factory.call_count,1)

if __name__ == '__main__':
    unittest.main()
