import os
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "wordfreq.py")


def run(*args):
    return subprocess.run([sys.executable, SCRIPT, *args], capture_output=True, text=True, timeout=30)


class HiddenWordfreqTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, text):
        path = os.path.join(self.tmp.name, "input.txt")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        return path

    def lines(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]

    def test_counts_case_insensitive_and_sorted(self):
        path = self.write("The cat and the hat.\nThe CAT sat!")
        self.assertEqual(self.lines(run(path)), ["the 3", "cat 2", "and 1", "hat 1", "sat 1"])

    def test_top(self):
        path = self.write("b a b c b a")
        self.assertEqual(self.lines(run(path, "--top", "2")), ["b 3", "a 2"])

    def test_apostrophes_and_digits(self):
        path = self.write("Don't stop, don't! 42 apples, 42 pears.")
        self.assertEqual(self.lines(run(path, "--top", "2")), ["42 2", "don't 2"])

    def test_default_top_is_10(self):
        words = " ".join(f"w{i:02d}" for i in range(15))
        self.assertEqual(len(self.lines(run(self.write(words)))), 10)

    def test_missing_file(self):
        result = run(os.path.join(self.tmp.name, "nope.txt"))
        self.assertEqual(result.returncode, 1)
        self.assertTrue(result.stderr.strip())


if __name__ == "__main__":
    unittest.main()
