import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
# collect interesting lines with context
keep = set()
for i, l in enumerate(lines):
    ll = l.lower()
    if re.search(r'\berror\b', ll) or re.search(r'\bfailed\b', ll) or 'panicked' in ll or 'caused by' in ll:
        for j in range(max(0, i-3), min(len(lines), i+4)):
            keep.add(j)
out_idx = sorted(keep)
if not out_idx:
    out_idx = list(range(max(0, len(lines)-60), len(lines)))
# cap at 60 annotations
out_idx = out_idx[:60]
for i in out_idx:
    l = lines[i]
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::{msg}")
