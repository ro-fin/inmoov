import copy
import json
import unittest
from standalone_motion.home_joint import SAFETY
from standalone_motion.hi_loop import PINS, SPEED, BASE_SLEW, poses, gesture_plan, blend

class StopGestureTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads(SAFETY.read_text())

    def test_stop_holds_forward_pose_then_returns_home_without_waving(self):
        joints,home,a,b=poses(self.data,'stop')
        plan=gesture_plan(self.data,'stop')
        self.assertEqual([p[0] for p in plan],['raise','hold','home'])
        self.assertEqual(a,(1537,1500,1315,1389))
        self.assertEqual(a,b)
        self.assertAlmostEqual(plan[1][3]/SPEED,3)
        self.assertEqual(plan[-1][2],home)
        for name,start,target,duration in plan:
            for tick in range(101):
                values=blend(start,target,duration*tick/100,duration)
                self.assertTrue(all(joints[p]['min_us']<=v<=joints[p]['max_us'] for p,v in zip(PINS,values)))
            self.assertLessEqual(1.875*max(abs(x-y) for x,y in zip(start,target))/duration*SPEED,BASE_SLEW*SPEED+1e-9)

    def test_stop_rejects_invalid_target_and_hold(self):
        bad=copy.deepcopy(self.data)
        bad['stop_gesture']['raw_pose']['5']=67
        with self.assertRaises(ValueError): poses(bad,'stop')
        bad=copy.deepcopy(self.data)
        bad['stop_gesture']['hold_seconds']=float('nan')
        with self.assertRaises(ValueError): gesture_plan(bad,'stop')

if __name__=='__main__': unittest.main()
