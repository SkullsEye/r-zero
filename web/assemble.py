import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.join(ROOT, "parts")


def read(name):
    return open(os.path.join(HERE, name), encoding="utf-8").read()


def build(out_path):
    page = read("shell.html")
    page = page.replace("__STYLES__", read("styles.css").rstrip())
    for token, name in (("__HOME__", "home.html"), ("__DATA__", "data.html"),
                        ("__EXPERIMENTS__", "experiments.html"),
                        ("__MODEL__PAGE__", "model.html"),
                        ("__ARCHITECTURE__", "architecture.html")):
        page = page.replace(token, read(name).rstrip())
    page = page.replace("__APPJS__", read("app.js").rstrip())
    for token, name in (("__MODEL__", "web_model.json"), ("__SAMPLE__", "sample.json"),
                        ("__FACTS__", "facts.json"), ("__CALIB__", "calibration_curve.json")):
        page = page.replace(token, open(os.path.join(ROOT, name), encoding="utf-8").read().strip())
    open(out_path, "w", encoding="utf-8").write(page)
    return os.path.getsize(out_path)


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "index.html")
    print(f"{os.path.basename(target)} {build(target) / 1024 / 1024:.2f} MB")
