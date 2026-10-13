import unittest
from arm_desktop import defaults, validate
from calibrator_motion import GestureRun, PINS, JOINT_SAFETY, MAX_STEP_US, FRAME_INTERVAL

class CalibratorMotionTests(unittest.TestCase):
    def home(self): return tuple(JOINT_SAFETY[p]['home_us'] for p in PINS)

    def test_shared_clock_waits_for_every_acknowledgement(self):
        run=GestureRun('hi',defaults(),self.home(),now=0)
        target=run.next_frame(0)
        run.acknowledge(2,target[0])
        self.assertIsNone(run.next_frame(.05))
        self.assertEqual(run.elapsed,0)
        for p,v in zip(PINS[1:],target[1:]): run.acknowledge(p,v)
        self.assertIsNone(run.next_frame(.1))
        self.assertIsNotNone(run.next_frame(FRAME_INTERVAL))
        self.assertGreater(run.elapsed,0)

    def test_sequence_and_loop_stay_in_bounds_with_continuous_home_returns(self):
        run=GestureRun('sequence',defaults(),self.home(),loop=True,now=0)
        now=0
        previous=self.home()
        largest_step=0
        while run.cycles<2:
            now+=.05
            target=run.next_frame(now)
            if target:
                for p,a,b in zip(PINS,previous,target):
                    self.assertLessEqual(abs(b-a),MAX_STEP_US[p])
                    largest_step=max(largest_step,abs(b-a))
                previous=target
                for p,v in zip(PINS,target):
                    self.assertTrue(JOINT_SAFETY[p]['min_us']<=v<=JOINT_SAFETY[p]['max_us'])
                    run.acknowledge(p,v)
        self.assertFalse(run.finished)
        self.assertGreater(largest_step,4)
        run.loop=False
        while not run.finished:
            now+=.05
            target=run.next_frame(now)
            if target:
                for p,v in zip(PINS,target): run.acknowledge(p,v)
        self.assertEqual(run.last_target,self.home())

    def test_late_ack_does_not_cause_catchup_jump(self):
        run=GestureRun('hi',defaults(),self.home(),now=0)
        first=run.next_frame(0)
        self.assertIsNone(run.next_frame(.5))
        for p,v in zip(PINS,first):run.acknowledge(p,v)
        target=run.next_frame(.6)
        for p,a,b in zip(PINS,first,target):
            self.assertLessEqual(abs(b-a),MAX_STEP_US[p])

    def test_faults_do_not_advance_or_resume(self):
        run=GestureRun('hi',defaults(),self.home(),now=0)
        run.next_frame(0)
        with self.assertRaises(RuntimeError): run.next_frame(.8)
        run=GestureRun('hi',defaults(),self.home(),now=0)
        run.next_frame(0)
        for i in range(1,33): run.next_frame(i*.05)
        with self.assertRaises(RuntimeError): run.next_frame(1.65)

    def test_manual_limits_imports_and_gestures_cannot_widen_safety(self):
        data=dict(format='RoboAttis-Nano-Arms',version=3,servos=defaults(),sequence=None)
        data['servos'][3]['minUs']=500
        with self.assertRaises(ValueError): validate(data)
        profiles=defaults()
        profiles[0]['minUs']=1550
        with self.assertRaises(ValueError): GestureRun('hi',profiles,self.home())
        profiles=defaults()
        profiles[3]['restUs']=1500
        with self.assertRaises(ValueError): GestureRun('hi',profiles,self.home())

if __name__=='__main__': unittest.main()
