import sys

from rzero.pipeline import run

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "data/ieee_slim.csv"
    run(path)
