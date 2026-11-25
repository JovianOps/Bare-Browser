import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
err_idx = []
for i, l in enumerate(lines):
    if re.match(r'^\s*(Downloaded|Downloading|Compiling|Checking|Fresh|Documenting|Building|Locking|Adding|Updating)\b', l):
        continue
    ll = l.lower()
    if re.search(r'\berror\b', ll) or re.search(r'\bfailed\b', ll) or 'panicked' in ll:
        err_idx.append(i)
pick = []
seen = set()
def add(i):
    if 0 <= i < len(lines) and i not in seen:
        seen.add(i); pick.append(i)
if err_idx:
    for j in range(max(0, err_idx[0]-1), min(len(lines), err_idx[0]+5)):
        add(j)
for j in range(max(0, len(lines)-5), len(lines)):
    add(j)
pick = sorted(pick)
# if no real errors, emit just meta
real_errs = [i for i in err_idx if not re.search(r'warning:', lines[i].lower())]
if not real_errs:
    msg = f"[emit] {path} lines={len(lines)} no_errors"
    print(f"::notice file={path}::{msg.replace('%','%25')}")
    sys.exit(0)
pick = pick[-5:]
meta = f"[emit] {path} lines={len(lines)} errs={len(real_errs)}"
print(f"::error file={path}::{meta.replace('%','%25')}")
for i in pick:
    l = lines[i]
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::L{i+1}: {msg}")
