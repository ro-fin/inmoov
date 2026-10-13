import copy
import json
import unittest
from standalone_motion.home_joint import SAFETY
from standalone_motion.hi_loop import (PINS, SPEED, BASE_SLEW, blend, ease,
                                      gesture_plan, poses, starting_pulses)

class HiGestureTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads(SAFETY.read_text())

    def test_two_actual_rotation_waves_and_home_return(self):
        joints,home,a,b=poses(self.data)
        plan=gesture_plan(self.data)
        rotation=[p[2][1] for p in plan if p[0].startswith('wave_')]
        self.assertEqual(rotation,[b[1],a[1],b[1],a[1]])
        self.assertEqual(plan[0][1],home)
        self.assertEqual(plan[-1][2],home)
        self.assertEqual(home,(1600,1500,1626,1604))

    def test_all_four_move_with_bounded_speed_and_targets(self):
        joints,home,a,b=poses(self.data)
        self.assertTrue(all(x!=y for x,y in zip(a,b)))
        for name,start,target,duration in gesture_plan(self.data):
            if not duration:
                continue
            previous=start
            dt=.001
            for k in range(int(duration/dt)+2):
                t=min(duration,k*dt)
                values=blend(start,target,t,duration)
                for pin,value in zip(PINS,values):
                    self.assertTrue(joints[pin]['min_us']<=value<=joints[pin]['max_us'])
                previous=values
            self.assertEqual(previous,target)
            self.assertLessEqual(1.875*max(abs(x-y) for x,y in zip(start,target))/duration*SPEED,BASE_SLEW*SPEED+1e-9)
        eps=1e-5
        self.assertAlmostEqual((ease(eps,1)-ease(0,1))/eps,0,places=7)
        self.assertAlmostEqual((ease(1,1)-ease(1-eps,1))/eps,0,places=7)

    def test_bad_target_rejected_before_serial(self):
        for pin,value in [('5',67),('4',79),('3',161),('2',119),('3',float('nan'))]:
            bad=copy.deepcopy(self.data)
            bad['hi_gesture']['raw_pose_a'][pin]=value
            with self.assertRaises(ValueError):
                poses(bad)

    def test_unknown_detached_position_requires_home_confirmation(self):
        joints,home,a,b=poses(self.data)
        states={p:0 for p in range(2,10)}
        with self.assertRaises(ValueError):
            starting_pulses(states,joints,False)
        self.assertEqual(starting_pulses(states,joints,True),home)
        states[5]=999
        with self.assertRaises(ValueError):
            starting_pulses(states,joints,True)

if __name__=='__main__':
    unittest.main()
