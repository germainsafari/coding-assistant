import unittest

from inventory import Inventory, OutOfStock


class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.inv = Inventory()
        self.inv.add("apple", 5)
        self.inv.add("pear", 2)

    def test_add_accumulates(self):
        self.inv.add("apple", 3)
        self.assertEqual(self.inv.count("apple"), 8)

    def test_add_rejects_non_positive(self):
        with self.assertRaises(ValueError):
            self.inv.add("apple", 0)

    def test_remove_some(self):
        self.inv.remove("apple", 2)
        self.assertEqual(self.inv.count("apple"), 3)

    def test_remove_too_many_raises(self):
        with self.assertRaises(OutOfStock):
            self.inv.remove("pear", 3)
        self.assertEqual(self.inv.count("pear"), 2)

    def test_remove_all_drops_sku(self):
        self.inv.remove("pear", 2)
        self.assertEqual(self.inv.skus(), ["apple"])

    def test_total_units(self):
        self.assertEqual(self.inv.total_units(), 7)


if __name__ == "__main__":
    unittest.main()
