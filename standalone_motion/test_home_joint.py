import json
import unittest
from standalone_motion.home_joint import SAFETY, home_targets, lift_value_to_pulse


class StandaloneSafetyTests(unittest.TestCase):
    def setUp(self):
        self.joints = json.loads(SAFETY.read_text())['joints']
        self.bicep = self.joints[3]

    def test_new_home_and_maximum_lift_scale(self):
        self.assertEqual(lift_value_to_pulse(self.bicep, 0), 1604)
        self.assertEqual(lift_value_to_pulse(self.bicep, 68), 1004)
        for value in (-1, 69, float('nan')):
            with self.assertRaises(ValueError):
                lift_value_to_pulse(self.bicep, value)

    def test_home_return_is_bounded_monotonic_and_gradual(self):
        targets = list(home_targets(self.bicep, 1004))
        self.assertEqual((targets[0], targets[-1]), (1004, 1604))
        self.assertTrue(all(1004 <= t <= 1604 for t in targets))
        self.assertTrue(all(0 <= b-a <= 3 for a, b in zip(targets, targets[1:])))
        for start in (1003, 1605):
            with self.assertRaises(ValueError):
                list(home_targets(self.bicep, start))

    def test_existing_three_joint_limits_are_preserved(self):
        expected = [(2,1600,1389,1604),(3,1500,1204,1685),(4,1626,1093,1856)]
        self.assertEqual([(j['pin'], j['home_us'], j['min_us'], j['max_us']) for j in self.joints[:3]], expected)


if __name__ == '__main__':
    unittest.main()
