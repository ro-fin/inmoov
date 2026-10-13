import copy
import json
import unittest
from standalone_motion.home_joint import SAFETY
from standalone_motion.hi_loop import PINS, SPEED, BASE_SLEW, poses, gesture_plan, blend

class LeftGestureTests(unittest.TestCase):
    def setUp(self):
        self.data=json.loads(SAFETY.read_text())

    def test_left_direction_and_distinct_pose_with_home_return(self):
        joints,home,target,_=poses(self.data,'left')
        stop=poses(self.data,'stop')[2]
        self.assertLess(target[0],home[0])
        self.assertLess(target[1],home[1])  # Operator's decreasing D3 direction is outward.
        self.assertGreater(target[3],stop[3])  # Less elbow flexion than Stop.
        plan=gesture_plan(self.data,'left')
        self.assertEqual([p[0] for p in plan],['extend_left','hold','home'])
        self.assertAlmostEqual(plan[1][3]/SPEED,3)
        self.assertEqual(plan[-1][2],home)
        for name,start,end,duration in plan:
            for tick in range(201):
                values=blend(start,end,duration*tick/200,duration)
                self.assertTrue(all(joints[p]['min_us']<=v<=joints[p]['max_us'] for p,v in zip(PINS,values)))
            self.assertLessEqual(1.875*max(abs(x-y) for x,y in zip(start,end))/duration*SPEED,BASE_SLEW*SPEED+1e-9)

    def test_invalid_outward_target_rejected_before_opening_serial(self):
        bad=copy.deepcopy(self.data)
        bad['left_gesture']['raw_pose']['3']=94
        with self.assertRaises(ValueError): poses(bad,'left')

if __name__=='__main__': unittest.main()
