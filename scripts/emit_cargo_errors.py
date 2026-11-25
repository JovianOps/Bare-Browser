import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
priority = []
seen = set()
def add(i):
    if 0 <= i < len(lines) and i not in seen:
        seen.add(i)
        priority.append(i)
def is_noise(l):
    return bool(re.match(r'^\s*(Downloaded|Downloading|Compiling|Checking|Fresh|Documenting|Building|Locking|Adding|Updating)\b', l))
# real errors first
for i, l in enumerate(lines):
    if is_noise(l):
        continue
    ll = l.lower()
    if re.search(r'\berror\b', ll) or re.search(r'\bfailed\b', ll) or 'panicked' in ll or 'caused by' in ll:
        for j in range(max(0, i-1), min(len(lines), i+3)):
            add(j)
# tail always
for j in range(max(0, len(lines)-15), len(lines)):
    add(j)
out_idx = sorted(priority)[:10]
meta = f"[emit] lines={len(lines)} showing={len(out_idx)}"
print(f"::error file={path}::{meta.replace('%','%25')}")
for i in out_idx:
    l = lines[i]
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::L{i+1}: {msg}")
