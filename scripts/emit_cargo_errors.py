import re, sys
path = sys.argv[1] if len(sys.argv) > 1 else "cargo-check.log"
try:
    text = open(path, errors="ignore").read()
except Exception:
    sys.exit(0)
text = re.sub(r'\x1b\[[0-9;]*[mK]', '', text)
lines = text.splitlines()
out = []
# prefer real rustc errors
for i, l in enumerate(lines):
    if re.match(r'^error(\[E\d+\])?:', l):
        if 'could not compile' in l or 'aborting due to' in l:
            continue
        out = lines[max(0,i-2):i+70]
        break
if not out:
    # fallback: any error line
    for i, l in enumerate(lines):
        if l.startswith('error'):
            out = lines[max(0,i-2):i+70]
            break
if not out:
    out = lines[-60:]
seen = 0
for l in out[:60]:
    msg = l.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
    print(f"::error file={path}::{msg}")
    seen += 1
