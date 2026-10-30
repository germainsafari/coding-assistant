import unittest

from inventory import Inventory, OutOfStock


class HiddenInventoryTest(unittest.TestCase):
    def test_remove_exactly_available(self):
        inv = Inventory()
        inv.add("x", 4)
        inv.remove("x", 4)
        self.assertEqual(inv.count("x"), 0)
        self.assertNotIn("x", inv.skus())

    def test_remove_one_too_many(self):
        inv = Inventory()
        inv.add("x", 1)
        with self.assertRaises(OutOfStock):
            inv.remove("x", 2)

    def test_remove_unknown(self):
        with self.assertRaises(OutOfStock):
            Inventory().remove("ghost", 1)

    def test_remove_rejects_non_positive(self):
        inv = Inventory()
        inv.add("x", 1)
        with self.assertRaises(ValueError):
            inv.remove("x", 0)


if __name__ == "__main__":
    unittest.main()
