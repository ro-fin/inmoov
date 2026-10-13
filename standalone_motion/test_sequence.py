import json
import unittest
from standalone_motion.home_joint import SAFETY
from standalone_motion.hi_loop import PINS, poses, gesture_plan, blend

class SequenceTests(unittest.TestCase):
    def test_gestures_in_order_with_home_boundaries_and_no_target_jump(self):
        data=json.loads(SAFETY.read_text())
        joints,home,_,_=poses(data)
        plan=gesture_plan(data,'sequence')
        self.assertEqual([name for name,_,_,_ in plan if name.endswith('_home')],
                         ['hi_home','stop_home','left_home'])
        previous=home
        for name,start,end,duration in plan:
            self.assertEqual(start,previous)
            for i in range(101):
                values=blend(start,end,duration*i/100,duration)
                self.assertTrue(all(joints[p]['min_us']<=v<=joints[p]['max_us'] for p,v in zip(PINS,values)))
            previous=end
        self.assertEqual(previous,home)
        self.assertEqual([name for name,_,_,_ in plan if name.endswith('_rest')],['hi_rest','stop_rest'])

if __name__=='__main__': unittest.main()
