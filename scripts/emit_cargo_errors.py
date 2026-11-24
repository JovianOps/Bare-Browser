import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
out = []
for i, l in enumerate(lines):
    if l.startswith("error") or l.startswith("error["):
        out = lines[i:i+60]
        break
if not out:
    out = lines[-60:]
for l in out[:60]:
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::{msg}")
