"""A tiny in-memory inventory."""


class OutOfStock(Exception):
    """Raised when removing more units than are in stock."""


class Inventory:
    def __init__(self):
        self._items = {}

    def add(self, sku, qty):
        if qty <= 0:
            raise ValueError("qty must be positive")
        self._items[sku] = self._items.get(sku, 0) + qty

    def remove(self, sku, qty):
        """Remove units. SKUs that reach zero disappear from skus()."""
        if qty <= 0:
            raise ValueError("qty must be positive")
        have = self._items.get(sku, 0)
        if qty > have + 1:
            raise OutOfStock(sku)
        self._items[sku] = have - qty

    def count(self, sku):
        return self._items.get(sku, 0)

    def skus(self):
        return sorted(self._items)

    def total_units(self):
        return sum(self._items.values())
